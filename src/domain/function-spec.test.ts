import { describe, expect, it } from "vitest";
import {
    assertFunctionArguments,
    buildFunctionHarness,
    expectedFunctionOutput,
    type FunctionSpec,
} from "./function-spec";

const spec: FunctionSpec = {
    name: "sumValues",
    parameters: [
        { name: "values", type: "integer[]" },
        { name: "bonus", type: "integer" },
    ],
    returnType: "integer",
};

describe("function submission harness", () => {
    it("builds a JavaScript harness that calls the submitted function", () => {
        const source = "const sumValues = (values, bonus) => values.reduce((a,b)=>a+b, bonus);";
        const harness = buildFunctionHarness("javascript", source, spec, [[1, 2], 3]);
        expect(harness).toContain("sumValues(...[[1,2],3])");
        expect(harness).toContain("JSON.stringify(__result)");
    });

    it("builds Java and C++ array literals", () => {
        expect(
            buildFunctionHarness("java", "static int sumValues(int[] v, int b){return b;}", spec, [
                [1, 2],
                3,
            ]),
        ).toContain("new int[]{1, 2}");
        expect(
            buildFunctionHarness("cpp", "int sumValues(vector<int> v,int b){return b;}", spec, [
                [1, 2],
                3,
            ]),
        ).toContain("vector<int>{1, 2}");
    });

    it("validates arguments and serializes expected values", () => {
        expect(() => assertFunctionArguments(spec, [[1, 2], 3])).not.toThrow();
        expect(() => assertFunctionArguments(spec, ["wrong", 3])).toThrow();
        expect(expectedFunctionOutput([1, true, "a"])).toBe('[1,true,"a"]');
    });
});
