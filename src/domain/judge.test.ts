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
            expect(args).toContain("--rm");
            expect(args).toContain("--init");
            expect(args).toContain("never");
            expect(args).toContain("--read-only");
            expect(args).toContain("1g");
            expect(args).toContain("ALL");
            expect(args).toContain("no-new-privileges");
            expect(args).toContain("65534:65534");
            expect(args).not.toContain("--mount");
        }
    });
    it("selects the requested runtime image and C++ standard", () => {
        expect(dockerArgumentsFor("javascript", "job", "node22")).toContain(
            "node:22.22.0-bookworm-slim",
        );
        const cpp = dockerArgumentsFor("cpp", "job", "cpp17-gcc13");
        expect(cpp).toContain("gcc:13.4");
        expect(cpp.at(-1)).toContain("-std=gnu++17");
    });
});
