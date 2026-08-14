import { describe, expect, it } from "vitest";
import { dayjs } from "../lib/dayjs-config";
import {
    applyFirstAccepted,
    applyInactivity,
    canAccessProblem,
    gradeProgress,
    submissionLimit,
    type GradeState,
} from "./grade-policy";

const initial = (): GradeState => ({
    grade: 9,
    verifiedSolves: 0,
    checkpoint: 0,
    championsEligible: false,
    lastFirstAcceptedAt: null,
    lastDemotedAt: null,
});
describe("grade policy", () => {
    it("allows own, lower, and exactly one higher grade", () => {
        expect(canAccessProblem(6, 5)).toBe(true);
        expect(canAccessProblem(6, 9)).toBe(true);
        expect(canAccessProblem(6, 4)).toBe(false);
    });

    it("allows administrators to access every problem grade", () => {
        expect(canAccessProblem(9, 1, true)).toBe(true);
        expect(canAccessProblem(1, 9, true)).toBe(true);
    });
    it("promotes after five completed problems in grades 9 through 7", () => {
        let state = initial();
        for (let i = 0; i < 4; i++) state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(9);
        state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(8);
        expect(state.verifiedSolves).toBe(5);
        expect(gradeProgress(state)).toMatchObject({ current: 0, required: 5 });
        for (let i = 0; i < 10; i++) state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(6);
    });
    it.each([
        { grade: 6 as const, interval: 10, next: 5 as const },
        { grade: 5 as const, interval: 10, next: 4 as const },
        { grade: 4 as const, interval: 15, next: 3 as const },
        { grade: 3 as const, interval: 15, next: 2 as const },
        { grade: 2 as const, interval: 20, next: 1 as const },
    ])("promotes $grade급 after $interval completed problems", ({ grade, interval, next }) => {
        let state: GradeState = { ...initial(), grade, verifiedSolves: 100, checkpoint: 100 };
        for (let i = 0; i < interval - 1; i++)
            state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(grade);
        state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(next);
        expect(state.checkpoint).toBe(100 + interval);
    });
    it("grants a league ticket after 30 completed grade-1 problems", () => {
        let state: GradeState = {
            ...initial(),
            grade: 1 as const,
            verifiedSolves: 85,
            checkpoint: 85,
        };
        for (let i = 0; i < 29; i++) state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.championsEligible).toBe(false);
        expect(gradeProgress(state)).toMatchObject({ current: 29, required: 30 });
        const result = applyFirstAccepted(state, dayjs().toDate());
        expect(result.state.championsEligible).toBe(true);
        expect(result.events).toContainEqual(
            expect.objectContaining({ kind: "CHAMPIONS_ELIGIBLE" }),
        );
        expect(gradeProgress(result.state)).toMatchObject({
            current: 30,
            required: 30,
            label: "리그 참가권 획득",
        });
    });
    it("demotes after 14 days and requires a fresh interval", () => {
        const old = dayjs("2026-07-01T00:00:00Z").toDate();
        const current = {
            ...initial(),
            grade: 6 as const,
            verifiedSolves: 15,
            lastFirstAcceptedAt: old,
            checkpoint: 15,
        };
        const demoted = applyInactivity(current, dayjs("2026-07-15T00:00:01Z").toDate(), old).state;
        expect(demoted.grade).toBe(7);
        let state = demoted;
        for (let i = 0; i < 4; i++) state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(7);
        state = applyFirstAccepted(state, dayjs().toDate()).state;
        expect(state.grade).toBe(6);
    });
    it("revokes champions and drops to grade 3", () => {
        const state = {
            ...initial(),
            grade: 1 as const,
            verifiedSolves: 52,
            championsEligible: true,
            lastFirstAcceptedAt: dayjs("2026-01-01").toDate(),
        };
        expect(
            applyInactivity(state, dayjs("2026-01-16").toDate(), dayjs("2025-01-01").toDate())
                .state,
        ).toMatchObject({ grade: 3, championsEligible: false });
    });
    it("applies attempt limits by grade", () => {
        expect(submissionLimit(9)).toBe(5);
        expect(submissionLimit(4)).toBe(4);
        expect(submissionLimit(1)).toBe(2);
    });
});
