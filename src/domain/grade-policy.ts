import { dayjs } from "../lib/dayjs-config";

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const PROMOTION_THRESHOLDS = [
    { from: 9, to: 8, cumulative: 5, interval: 5 },
    { from: 8, to: 7, cumulative: 10, interval: 5 },
    { from: 7, to: 6, cumulative: 15, interval: 5 },
    { from: 6, to: 5, cumulative: 25, interval: 10 },
    { from: 5, to: 4, cumulative: 35, interval: 10 },
    { from: 4, to: 3, cumulative: 50, interval: 15 },
    { from: 3, to: 2, cumulative: 65, interval: 15 },
    { from: 2, to: 1, cumulative: 85, interval: 20 },
] as const;

export const LEAGUE_TICKET_INTERVAL = 30;
export const CHAMPIONS_THRESHOLD = 115;
export const INACTIVITY_DAYS = 14;

export function canAccessProblem(userGrade: Grade, problemGrade: Grade) {
    return problemGrade >= Math.max(1, userGrade - 1);
}

export function submissionLimit(grade: Grade, champions = false) {
    if (champions || grade === 1) return 2;
    if (grade <= 4) return 4;
    return 5;
}

export type GradeState = {
    grade: Grade;
    verifiedSolves: number;
    checkpoint: number;
    championsEligible: boolean;
    lastFirstAcceptedAt: Date | null;
    lastDemotedAt: Date | null;
};

export type GradeEvent = {
    kind: "PROMOTED" | "DEMOTED" | "CHAMPIONS_ELIGIBLE" | "CHAMPIONS_REVOKED";
    fromGrade: Grade;
    toGrade: Grade;
    at: Date;
};

export function applyFirstAccepted(
    state: GradeState,
    at: Date,
): { state: GradeState; events: GradeEvent[] } {
    let next = { ...state, verifiedSolves: state.verifiedSolves + 1, lastFirstAcceptedAt: at };
    const events: GradeEvent[] = [];

    while (next.grade > 1) {
        const rule = PROMOTION_THRESHOLDS.find((candidate) => candidate.from === next.grade)!;
        // A demotion establishes a new checkpoint: the interval must be earned again.
        const required = next.checkpoint + rule.interval;
        if (next.verifiedSolves < required) break;
        const fromGrade = next.grade;
        next = { ...next, grade: rule.to as Grade, checkpoint: next.verifiedSolves };
        events.push({ kind: "PROMOTED", fromGrade, toGrade: next.grade, at });
    }

    if (next.grade === 1 && !next.championsEligible) {
        const required = next.checkpoint + LEAGUE_TICKET_INTERVAL;
        if (next.verifiedSolves >= required) {
            next = { ...next, championsEligible: true, checkpoint: next.verifiedSolves };
            events.push({ kind: "CHAMPIONS_ELIGIBLE", fromGrade: 1, toGrade: 1, at });
        }
    }

    return { state: next, events };
}

export function applyInactivity(state: GradeState, now: Date, joinedAt: Date) {
    const anchor = state.lastDemotedAt ?? state.lastFirstAcceptedAt ?? joinedAt;
    const elapsedDays = dayjs(now).diff(dayjs(anchor), "day", true);
    if (elapsedDays < INACTIVITY_DAYS || state.grade === 9)
        return { state, events: [] as GradeEvent[] };

    if (state.grade === 1 && state.championsEligible) {
        const next = {
            ...state,
            grade: 3 as Grade,
            championsEligible: false,
            checkpoint: state.verifiedSolves,
            lastDemotedAt: now,
        };
        return {
            state: next,
            events: [
                { kind: "CHAMPIONS_REVOKED", fromGrade: 1, toGrade: 1, at: now },
                { kind: "DEMOTED", fromGrade: 1, toGrade: 3, at: now },
            ] satisfies GradeEvent[],
        };
    }

    const nextGrade = Math.min(9, state.grade + 1) as Grade;
    const next = {
        ...state,
        grade: nextGrade,
        checkpoint: state.verifiedSolves,
        lastDemotedAt: now,
    };
    return {
        state: next,
        events: [
            { kind: "DEMOTED", fromGrade: state.grade, toGrade: nextGrade, at: now },
        ] satisfies GradeEvent[],
    };
}

export function gradeProgress(state: GradeState) {
    if (state.grade === 1) {
        return {
            current: state.championsEligible
                ? LEAGUE_TICKET_INTERVAL
                : Math.max(0, state.verifiedSolves - state.checkpoint),
            required: LEAGUE_TICKET_INTERVAL,
            label: state.championsEligible ? "리그 참가권 획득" : "리그 참가권",
        };
    }
    const rule = PROMOTION_THRESHOLDS.find((candidate) => candidate.from === state.grade)!;
    return {
        current: Math.max(0, state.verifiedSolves - state.checkpoint),
        required: rule.interval,
        label: `${rule.to}급`,
    };
}
