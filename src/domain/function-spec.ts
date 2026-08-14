import { z } from "zod";
import type { JudgeLanguage } from "./judge";

export const functionValueTypeSchema = z.enum([
    "integer",
    "long",
    "number",
    "string",
    "boolean",
    "integer[]",
    "long[]",
    "number[]",
    "string[]",
    "boolean[]",
]);

export const functionSpecSchema = z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    parameters: z
        .array(
            z.object({
                name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
                type: functionValueTypeSchema,
            }),
        )
        .max(8),
    returnType: functionValueTypeSchema,
});

const primitiveValueSchema = z.union([z.number().finite(), z.string(), z.boolean()]);
export const functionTestValueSchema = z.union([
    primitiveValueSchema,
    z.array(primitiveValueSchema),
]);
export const functionTestSchema = z.object({
    input: z.string(),
    output: z.string(),
    arguments: z.array(functionTestValueSchema),
    expected: functionTestValueSchema,
});

export type FunctionValueType = z.infer<typeof functionValueTypeSchema>;
export type FunctionSpec = z.infer<typeof functionSpecSchema>;
export type FunctionTestValue = z.infer<typeof functionTestValueSchema>;

export function buildFunctionHarness(
    language: JudgeLanguage,
    source: string,
    spec: FunctionSpec,
    arguments_: FunctionTestValue[],
) {
    assertFunctionArguments(spec, arguments_);
    if (language === "javascript")
        return `"use strict";
${source}
const __result = ${spec.name}(...${JSON.stringify(arguments_)});
if (__result === undefined) throw new Error("함수가 값을 반환하지 않았습니다.");
process.stdout.write(JSON.stringify(__result));`;
    if (language === "python")
        return `import json
${source}
__args = ${pythonLiteral(arguments_)}
__result = ${spec.name}(*__args)
print(json.dumps(__result, ensure_ascii=False, separators=(",", ":")), end="")`;
    if (language === "java") return javaHarness(source, spec, arguments_);
    return cppHarness(source, spec, arguments_);
}

export function expectedFunctionOutput(value: FunctionTestValue) {
    return JSON.stringify(value);
}

export function assertFunctionArguments(spec: FunctionSpec, arguments_: FunctionTestValue[]) {
    if (arguments_.length !== spec.parameters.length)
        throw new Error(`함수 인자는 ${spec.parameters.length}개여야 합니다.`);
    spec.parameters.forEach((parameter, index) => {
        if (!matchesType(arguments_[index], parameter.type))
            throw new Error(`${parameter.name} 인자가 ${parameter.type} 형식과 일치하지 않습니다.`);
    });
}

function matchesType(value: FunctionTestValue, type: FunctionValueType): boolean {
    if (type.endsWith("[]")) {
        if (!Array.isArray(value)) return false;
        const itemType = type.slice(0, -2) as FunctionValueType;
        return value.every((item) => !Array.isArray(item) && matchesType(item, itemType));
    }
    if (Array.isArray(value)) return false;
    if (type === "string") return typeof value === "string";
    if (type === "boolean") return typeof value === "boolean";
    if (type === "integer" || type === "long") return Number.isSafeInteger(value);
    return typeof value === "number" && Number.isFinite(value);
}

function pythonLiteral(value: FunctionTestValue | FunctionTestValue[]): string {
    if (Array.isArray(value)) return `[${value.map((item) => pythonLiteral(item)).join(", ")}]`;
    if (typeof value === "boolean") return value ? "True" : "False";
    return JSON.stringify(value);
}

function javaHarness(source: string, spec: FunctionSpec, arguments_: FunctionTestValue[]) {
    const args = arguments_
        .map((value, index) => javaLiteral(value, spec.parameters[index]!.type))
        .join(", ");
    return `import java.lang.reflect.Array;
public class Main {
${indent(source, 4)}
    public static void main(String[] args) {
        Object result = ${spec.name}(${args});
        System.out.print(toJson(result));
    }
    static String toJson(Object value) {
        if (value instanceof String text) return "\\\"" + text.replace("\\\\", "\\\\\\\\").replace("\\\"", "\\\\\\\"").replace("\\n", "\\\\n").replace("\\r", "\\\\r") + "\\\"";
        if (value instanceof Boolean flag) return flag ? "true" : "false";
        if (value != null && value.getClass().isArray()) {
            StringBuilder out = new StringBuilder("[");
            for (int index = 0; index < Array.getLength(value); index++) {
                if (index > 0) out.append(',');
                out.append(toJson(Array.get(value, index)));
            }
            return out.append(']').toString();
        }
        return String.valueOf(value);
    }
}`;
}

function javaLiteral(value: FunctionTestValue, type: FunctionValueType): string {
    if (type.endsWith("[]")) {
        if (!Array.isArray(value)) throw new Error("배열 인자가 필요합니다.");
        const itemType = type.slice(0, -2) as FunctionValueType;
        return `new ${javaType(itemType)}[]{${value.map((item) => javaLiteral(item, itemType)).join(", ")}}`;
    }
    if (Array.isArray(value)) throw new Error("스칼라 인자가 필요합니다.");
    if (type === "string") return JSON.stringify(value);
    if (type === "boolean") return value ? "true" : "false";
    if (type === "long") return `${value}L`;
    return String(value);
}

function javaType(type: FunctionValueType): string {
    const scalar = type.replace("[]", "") as FunctionValueType;
    const mapped =
        scalar === "integer"
            ? "int"
            : scalar === "long"
              ? "long"
              : scalar === "number"
                ? "double"
                : scalar === "string"
                  ? "String"
                  : "boolean";
    return type.endsWith("[]") ? `${mapped}[]` : mapped;
}

function cppHarness(source: string, spec: FunctionSpec, arguments_: FunctionTestValue[]) {
    const args = arguments_
        .map((value, index) => cppLiteral(value, spec.parameters[index]!.type))
        .join(", ");
    return `#include <bits/stdc++.h>
using namespace std;
${source}
string jsonEscape(const string& value) {
    string out = "\\\"";
    for (char ch : value) {
        if (ch == '\\\\' || ch == '\\"') out += '\\\\';
        if (ch == '\\n') out += "\\\\n";
        else if (ch == '\\r') out += "\\\\r";
        else out += ch;
    }
    return out + "\\\"";
}
template <typename T> void writeJson(const T& value) { cout << setprecision(17) << value; }
void writeJson(const string& value) { cout << jsonEscape(value); }
void writeJson(const bool value) { cout << (value ? "true" : "false"); }
template <typename T> void writeJson(const vector<T>& values) {
    cout << '[';
    for (size_t index = 0; index < values.size(); index++) {
        if (index) cout << ',';
        writeJson(values[index]);
    }
    cout << ']';
}
int main() {
    auto result = ${spec.name}(${args});
    writeJson(result);
}`;
}

function cppLiteral(value: FunctionTestValue, type: FunctionValueType): string {
    if (type.endsWith("[]")) {
        if (!Array.isArray(value)) throw new Error("배열 인자가 필요합니다.");
        const itemType = type.slice(0, -2) as FunctionValueType;
        return `vector<${cppType(itemType)}>{${value.map((item) => cppLiteral(item, itemType)).join(", ")}}`;
    }
    if (Array.isArray(value)) throw new Error("스칼라 인자가 필요합니다.");
    if (type === "string") return JSON.stringify(value);
    if (type === "boolean") return value ? "true" : "false";
    if (type === "long") return `${value}LL`;
    return String(value);
}

function cppType(type: FunctionValueType): string {
    const scalar = type.replace("[]", "") as FunctionValueType;
    const mapped =
        scalar === "integer"
            ? "int"
            : scalar === "long"
              ? "long long"
              : scalar === "number"
                ? "double"
                : scalar === "string"
                  ? "string"
                  : "bool";
    return type.endsWith("[]") ? `vector<${mapped}>` : mapped;
}

function indent(value: string, spaces: number) {
    const prefix = " ".repeat(spaces);
    return value
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
}
