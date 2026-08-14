import { describe, expect, it } from "vitest";
import { generationBlueprint, generationSchedule, scheduledGrades } from "./scheduler";
import { dayjs } from "../../lib/dayjs-config";

describe("tiered generation schedule", () => {
    it("generates grades 9 through 4 every day", () => {
        const tuesday = dayjs("2026-08-11T03:00:00Z").toDate();
        expect(scheduledGrades(tuesday, "1,3,5", "0")).toEqual([4, 5, 6, 7, 8, 9]);
    });

    it("adds grades 3 and 2 three times a week", () => {
        const wednesday = dayjs("2026-08-12T03:00:00Z").toDate();
        expect(scheduledGrades(wednesday, "1,3,5", "0")).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("adds grade 1 only on its weekly review day", () => {
        const sunday = dayjs("2026-08-16T03:00:00Z").toDate();
        expect(scheduledGrades(sunday, "1,3,5", "0")).toEqual([1, 4, 5, 6, 7, 8, 9]);
        expect(generationBlueprint(1)).toContain("국제 대회 결승 수준");
    });

    it("maps every grade to a research-calibrated difficulty rubric", () => {
        for (let grade = 1; grade <= 9; grade++)
            expect(generationBlueprint(grade)).toContain(`grade-${grade}`);
        expect(generationBlueprint(9)).toContain("LeetCode Easy");
        expect(generationBlueprint(5)).toContain("LeetCode Medium");
        expect(generationBlueprint(1)).toContain("LeetCode Hard");
    });

    it("calculates weekday and due time in KST", () => {
        const schedule = generationSchedule(dayjs("2026-08-15T15:06:00Z").toDate());
        expect(schedule.day).toBe("2026-08-16");
        expect(schedule.weekday).toBe(0);
        expect(schedule.due).toBe(true);
    });
});
