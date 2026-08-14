import { describe, expect, it } from "vitest";
import { problemFingerprint, problemTitleKey } from "./problem-identity";

const problem = {
    title: "두 조약돌의 무게",
    statement: "서로 다른 두 조약돌을 선택해 목표 무게를 만드는 문제입니다.",
    input: "함수 인자로 조약돌과 목표 무게가 전달됩니다.",
    output: "가능 여부를 불리언 값으로 반환합니다.",
    functionSpec: {
        name: "hasTwoSum",
        parameters: [{ name: "values", type: "long[]" as const }],
        returnType: "boolean" as const,
    },
    samples: [{ input: "sample", output: "true", arguments: [[1, 2]], expected: true }],
};

describe("problem identity", () => {
    it("ignores title spacing and punctuation", () => {
        expect(problemTitleKey(" 두 조약돌의-무게! ")).toBe("두조약돌의무게");
    });

    it("creates a stable fingerprint independent of cosmetic whitespace", () => {
        expect(problemFingerprint(problem)).toBe(
            problemFingerprint({ ...problem, statement: `  ${problem.statement}  ` }),
        );
    });

    it("detects identical content even when only the title changes", () => {
        const renamed = { ...problem, title: "목표 무게 만들기" };
        expect(problemFingerprint(problem)).toBe(problemFingerprint(renamed));
    });

    it("changes when the executable contract changes", () => {
        expect(problemFingerprint(problem)).not.toBe(
            problemFingerprint({
                ...problem,
                input: "함수 인자로 조약돌 배열만 전달됩니다.",
            }),
        );
    });
});
