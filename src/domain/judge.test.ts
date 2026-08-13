import { describe, expect, it } from "vitest";
import { compareOutput } from "./judge";
import { dockerArgumentsFor } from "../workers/judge/sandbox";
describe("judge policy", () => {
    it("compares whitespace-delimited tokens", () => {
        expect(compareOutput("1  2\n", "1\n2")).toBe(true);
        expect(compareOutput("12", "1 2")).toBe(false);
    });
    it("supports bounded floating point answers", () => {
        expect(compareOutput("0.3000001", "0.3", 1e-6)).toBe(true);
    });
    it("hardens every runtime", () => {
        for (const language of ["python", "java", "javascript", "cpp"] as const) {
            const args = dockerArgumentsFor(language);
            expect(args).toContain("none");
            expect(args).toContain("--read-only");
            expect(args).toContain("1g");
            expect(args).toContain("ALL");
            expect(args).toContain("no-new-privileges");
        }
    });
});
