import { describe, expect, it } from "vitest";
import { chooseNextProblem, kstDayKey } from "./assignment-policy";
import { dayjs } from "../lib/dayjs-config";
describe("assignment policy", () => {
    it("prefers a different primary concept", () => {
        const now = dayjs().toDate();
        const candidates = [
            {
                id: "same",
                grade: 6 as const,
                primaryTag: "graph",
                secondaryTags: [],
                publishedAt: now,
            },
            {
                id: "different",
                grade: 7 as const,
                primaryTag: "stack",
                secondaryTags: [],
                publishedAt: dayjs(0).toDate(),
            },
        ];
        expect(
            chooseNextProblem(6, candidates, new Set(), {
                id: "old",
                grade: 6,
                primaryTag: "graph",
                secondaryTags: [],
                publishedAt: now,
            })?.id,
        ).toBe("different");
    });
    it("uses KST day boundaries", () => {
        expect(kstDayKey(dayjs("2026-08-10T15:00:00Z").toDate())).toBe("2026-08-11");
    });
});
