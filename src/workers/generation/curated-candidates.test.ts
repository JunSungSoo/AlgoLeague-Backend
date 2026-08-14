import { describe, expect, it } from "vitest";
import { curatedCandidate } from "./curated-candidates";
import { generationBlueprint } from "./scheduler";

describe("research-calibrated curated candidates", () => {
    it("builds one unique, fully tested package for every grade", () => {
        const candidates = Array.from({ length: 9 }, (_, index) => {
            const grade = index + 1;
            return curatedCandidate({
                grade,
                blueprint: generationBlueprint(grade),
                blueprintVersion: "research-test-v1",
                seed: 26_081_400 + grade,
            });
        });

        expect(new Set(candidates.map((candidate) => candidate.title)).size).toBe(9);
        for (const [index, candidate] of candidates.entries()) {
            expect(candidate.grade).toBe(index + 1);
            expect(candidate.samples).toHaveLength(3);
            expect(candidate.hiddenTests).toHaveLength(8);
            expect(candidate.statement.length).toBeGreaterThanOrEqual(250);
            expect(Object.keys(candidate.solutions)).toEqual([
                "python",
                "java",
                "javascript",
                "cpp",
            ]);
        }
    });
});
