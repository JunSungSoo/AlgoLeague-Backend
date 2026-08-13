import { describe, expect, it } from "vitest";
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
    it("promotes cumulatively without resetting solves", () => {
        let state = initial();
        for (let i = 0; i < 3; i++) state = applyFirstAccepted(state, new Date()).state;
        expect(state.grade).toBe(8);
        expect(state.verifiedSolves).toBe(3);
        expect(gradeProgress(state)).toMatchObject({ current: 0, required: 3 });
    });
    it("demotes after 14 days and requires a fresh interval", () => {
        const old = new Date("2026-07-01T00:00:00Z");
        const current = {
            ...initial(),
            grade: 6 as const,
            verifiedSolves: 15,
            lastFirstAcceptedAt: old,
            checkpoint: 15,
        };
        const demoted = applyInactivity(current, new Date("2026-07-15T00:00:01Z"), old).state;
        expect(demoted.grade).toBe(7);
        let state = demoted;
        for (let i = 0; i < 2; i++) state = applyFirstAccepted(state, new Date()).state;
        expect(state.grade).toBe(7);
        state = applyFirstAccepted(state, new Date()).state;
        expect(state.grade).toBe(6);
    });
    it("revokes champions and drops to grade 3", () => {
        const state = {
            ...initial(),
            grade: 1 as const,
            verifiedSolves: 52,
            championsEligible: true,
            lastFirstAcceptedAt: new Date("2026-01-01"),
        };
        expect(
            applyInactivity(state, new Date("2026-01-16"), new Date("2025-01-01")).state,
        ).toMatchObject({ grade: 3, championsEligible: false });
    });
    it("applies attempt limits by grade", () => {
        expect(submissionLimit(9)).toBe(5);
        expect(submissionLimit(4)).toBe(4);
        expect(submissionLimit(1)).toBe(2);
    });
});
