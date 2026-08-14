import { describe, expect, it } from "vitest";
import { canAutoPublish, operationalGenerationState, requiresHumanReview } from "./generation";
import { dayjs } from "../lib/dayjs-config";

const passingReport = {
    schema: true,
    samples: true,
    crossLanguage: true,
    mutationScore: 0.86,
    duplicateScore: 0.08,
    ambiguityScore: 0.05,
    failures: [],
};

describe("generation publication policy", () => {
    it("marks active jobs as stopped when the generation worker is offline", () => {
        expect(operationalGenerationState("REQUESTED", false)).toBe("STOPPED");
        expect(operationalGenerationState("GENERATING", false)).toBe("STOPPED");
        expect(operationalGenerationState("REVIEW_REQUIRED", false)).toBe("REVIEW_REQUIRED");
        expect(operationalGenerationState("GENERATING", true)).toBe("GENERATING");
    });

    it("marks stale claimed jobs as stopped even when another worker is online", () => {
        const now = dayjs("2026-08-14T02:00:00Z").toDate();
        expect(
            operationalGenerationState(
                "GENERATING",
                true,
                dayjs("2026-08-14T01:20:00Z").toDate(),
                now,
            ),
        ).toBe("STOPPED");
        expect(
            operationalGenerationState(
                "GENERATING",
                true,
                dayjs("2026-08-14T01:50:00Z").toDate(),
                now,
            ),
        ).toBe("GENERATING");
    });
    it("auto-publishes validated grade 2 through 9 problems", () => {
        for (let grade = 2; grade <= 9; grade++)
            expect(canAutoPublish(grade, false, passingReport)).toBe(true);
    });
    it("requires review for grade 1 and champions problems", () => {
        expect(requiresHumanReview(1)).toBe(true);
        expect(canAutoPublish(1, false, passingReport)).toBe(false);
        expect(canAutoPublish(2, true, passingReport)).toBe(false);
    });
    it("does not publish a package that misses a validation gate", () => {
        expect(canAutoPublish(9, false, { ...passingReport, crossLanguage: false })).toBe(false);
        expect(canAutoPublish(9, false, { ...passingReport, failures: ["failed"] })).toBe(false);
    });
});
