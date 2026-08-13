import { describe, expect, it } from "vitest";
import { generateCandidate, providerOrder, ruleCandidate } from "./generator";

const request = {
    grade: 9,
    blueprint: "daily-grade-9",
    blueprintVersion: "daily-test",
    seed: 2026081209,
};

describe("generation providers", () => {
    it("parses and deduplicates provider order", () => {
        expect(providerOrder("openrouter, ollama,openrouter,rule")).toEqual([
            "openrouter",
            "ollama",
            "rule",
        ]);
        expect(providerOrder("invalid")).toEqual(["rule"]);
    });

    it("creates valid, varied rule packages with hidden tests", () => {
        for (let seed = 0; seed < 3; seed++) {
            const candidate = ruleCandidate({ ...request, seed });
            expect(candidate.grade).toBe(9);
            expect(candidate.generatorSeed).toBe(seed);
            expect(candidate.hiddenTests.length).toBeGreaterThanOrEqual(2);
            expect(Object.keys(candidate.solutions)).toEqual([
                "python",
                "java",
                "javascript",
                "cpp",
            ]);
            if (seed === 2) expect(candidate.samples[0]?.output).toBe("7\n");
        }
    });

    it("uses the rule provider first for lower difficulty grades", async () => {
        const generated = await generateCandidate(request);
        expect(generated.provider).toBe("rule");
        expect(generated.model).toBe("algoleague-rule-v2");
    });

    it("can exclude a failed provider and continue the chain", async () => {
        await expect(
            generateCandidate(request, new Set(["rule", "openai", "openrouter", "ollama"])),
        ).rejects.toThrow("사용 가능한 문제 생성 공급자가 없습니다");
    });
});
