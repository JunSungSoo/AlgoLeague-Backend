import OpenAI from "openai";
import { problemPackageSchema, type ProblemPackage } from "../../domain/generation";

export type GenerationRequest = {
    grade: number;
    blueprint: string;
    blueprintVersion: string;
    seed: number;
};
export type GenerationProvider = "openai" | "openrouter" | "ollama" | "rule";
export type GeneratedCandidate = {
    candidate: ProblemPackage;
    provider: GenerationProvider;
    model: string;
};

const providerNames = new Set<GenerationProvider>(["openai", "openrouter", "ollama", "rule"]);

export async function generateCandidate(
    request: GenerationRequest,
    excluded: ReadonlySet<GenerationProvider> = new Set(),
): Promise<GeneratedCandidate> {
    const configured = providerOrder();
    const gradeProviders =
        request.grade === 1
            ? configured.filter((provider) => provider !== "rule")
            : configured;
    const providers = gradeProviders.filter((provider) => !excluded.has(provider));
    const failures: string[] = [];

    for (const provider of providers) {
        try {
            if (provider === "openai") {
                if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 미설정");
                return {
                    candidate: await generateWithOpenAI(request),
                    provider,
                    model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
                };
            }
            if (provider === "openrouter") {
                if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY 미설정");
                const model =
                    process.env.OPENROUTER_MODEL ??
                    "openai/gpt-oss-20b:free";
                return { candidate: await generateWithOpenRouter(request, model), provider, model };
            }
            if (provider === "ollama") {
                const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
                return { candidate: await generateWithOllama(request, model), provider, model };
            }
            return { candidate: ruleCandidate(request), provider, model: "algoleague-rule-v2" };
        } catch (error) {
            failures.push(
                `${provider}: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
            );
        }
    }
    throw new Error(`사용 가능한 문제 생성 공급자가 없습니다. ${failures.join(" | ")}`);
}

export function providerOrder(value = process.env.GENERATION_PROVIDERS): GenerationProvider[] {
    const parsed = (value ?? "openai,openrouter,ollama,rule")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is GenerationProvider =>
            providerNames.has(item as GenerationProvider),
        );
    return [...new Set(parsed.length ? parsed : ["rule"])] as GenerationProvider[];
}

async function generateWithOpenAI(request: GenerationRequest) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: providerTimeout() });
    const response = await client.responses.create({
        model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
        input: generationPrompt(request),
        text: {
            format: {
                type: "json_schema",
                name: "problem_package",
                strict: true,
                schema: packageJsonSchema,
            },
        },
    });
    return parsePackage(response.output_text, request);
}

async function generateWithOpenRouter(request: GenerationRequest, model: string) {
    const response = await fetch(
        `${process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/chat/completions`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "x-title": "Algoleague",
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: generationPrompt(request) }],
                temperature: 0.2,
                max_tokens: 32_000,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "problem_package",
                        strict: true,
                        schema: packageJsonSchema,
                    },
                },
            }),
            signal: AbortSignal.timeout(providerTimeout()),
        },
    );
    if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parsePackage(body.choices?.[0]?.message?.content ?? "", request);
}

async function generateWithOllama(request: GenerationRequest, model: string) {
    const response = await fetch(
        `${process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434"}/api/chat`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model,
                stream: false,
                messages: [{ role: "user", content: generationPrompt(request) }],
                format: packageJsonSchema,
                options: { temperature: 0 },
            }),
            signal: AbortSignal.timeout(providerTimeout()),
        },
    );
    if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return parsePackage(body.message?.content ?? "", request);
}

function generationPrompt(request: GenerationRequest) {
    return `한국어 알고리즘 문제 패키지를 새로 작성하라. 등급은 ${request.grade}급, 설계는 ${request.blueprint}, 버전은 ${request.blueprintVersion}, 시드는 ${request.seed}이다. 알려진 문제의 문장·캐릭터·예제를 복제하지 말라. 설계에 명시된 알고리즘을 실제로 사용해야 하며 그보다 쉬운 단순 연산 문제로 낮추지 말라. title은 5자 이상, statement는 공백 포함 250자 이상의 완결된 한국어 설명, input과 output은 각각 30자 이상, explanation은 150자 이상 작성하라. 문제는 표준입출력 프로그램이 아니라 하나의 순수 함수를 완성하는 형식이어야 한다. functionSpec에 함수명·매개변수·반환형을 정의하고 Python, Java, JavaScript, C++23 solutions에는 해당 함수만 작성하라. main, 표준입력 읽기, 표준출력 코드는 포함하지 말라. samples는 정확히 3개를 만들고 각 테스트에 화면 표시용 input/output과 실행용 arguments/expected를 모두 넣어라. 경계값을 포함한 hiddenTests는 최소 8개 만들고 모든 반환값은 정확해야 한다. 각 언어 해답과 oracle은 모든 테스트에서 동일한 값을 반환해야 한다. generatorSeed와 blueprintVersion은 입력값을 그대로 사용하라. JSON 스키마만 출력하라.`;
}

function parsePackage(content: string, request: GenerationRequest) {
    const parsed = problemPackageSchema.parse(JSON.parse(content));
    if (
        parsed.grade !== request.grade ||
        parsed.generatorSeed !== request.seed ||
        parsed.blueprintVersion !== request.blueprintVersion
    )
        throw new Error("요청 메타데이터와 생성 결과가 일치하지 않습니다.");
    return parsed;
}

function providerTimeout() {
    const value = Number(process.env.GENERATION_PROVIDER_TIMEOUT_MS);
    return Number.isInteger(value) && value >= 5_000 && value <= 300_000 ? value : 90_000;
}

const testSchema = {
    type: "object",
    additionalProperties: false,
    required: ["input", "output", "arguments", "expected"],
    properties: {
        input: { type: "string" },
        output: { type: "string" },
        arguments: {
            type: "array",
            items: {
                oneOf: [
                    { type: "number" },
                    { type: "string" },
                    { type: "boolean" },
                    {
                        type: "array",
                        items: {
                            oneOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }],
                        },
                    },
                ],
            },
        },
        expected: {
            oneOf: [
                { type: "number" },
                { type: "string" },
                { type: "boolean" },
                {
                    type: "array",
                    items: {
                        oneOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }],
                    },
                },
            ],
        },
    },
} as const;

const valueTypeSchema = {
    type: "string",
    enum: [
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
    ],
} as const;

export const packageJsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "title",
        "statement",
        "input",
        "output",
        "constraints",
        "grade",
        "primaryTag",
        "secondaryTags",
        "functionSpec",
        "samples",
        "hiddenTests",
        "explanation",
        "solutions",
        "oracle",
        "generatorSeed",
        "blueprintVersion",
    ],
    properties: {
        title: { type: "string" },
        statement: { type: "string" },
        input: { type: "string" },
        output: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        grade: { type: "integer" },
        primaryTag: { type: "string" },
        secondaryTags: { type: "array", items: { type: "string" } },
        functionSpec: {
            type: "object",
            additionalProperties: false,
            required: ["name", "parameters", "returnType"],
            properties: {
                name: { type: "string" },
                parameters: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["name", "type"],
                        properties: { name: { type: "string" }, type: valueTypeSchema },
                    },
                },
                returnType: valueTypeSchema,
            },
        },
        samples: { type: "array", items: testSchema, minItems: 3, maxItems: 3 },
        hiddenTests: { type: "array", items: testSchema, minItems: 5 },
        explanation: { type: "string" },
        solutions: {
            type: "object",
            additionalProperties: false,
            required: ["python", "java", "javascript", "cpp"],
            properties: {
                python: { type: "string" },
                java: { type: "string" },
                javascript: { type: "string" },
                cpp: { type: "string" },
            },
        },
        oracle: { type: "string" },
        generatorSeed: { type: "integer" },
        blueprintVersion: { type: "string" },
    },
} as const;

export function ruleCandidate(request: GenerationRequest): ProblemPackage {
    const variant = Math.abs(request.seed) % 3;
    return variant === 0
        ? divisibleSumCandidate(request)
        : variant === 1
          ? twoSumCandidate(request)
          : maximumSubarrayCandidate(request);
}

function base(request: GenerationRequest) {
    return {
        grade: request.grade,
        generatorSeed: request.seed,
        blueprintVersion: request.blueprintVersion,
    };
}

function divisibleSumCandidate(request: GenerationRequest): ProblemPackage {
    return problemPackageSchema.parse({
        ...base(request),
        title: "갈대밭 표식의 합",
        statement:
            "알고달은 갈대밭 곳곳에 적힌 정수를 조사하고 있다. 기준 정수 K로 나누어떨어지는 표식만 골라 그 값의 합을 구하려 한다. 음수 표식도 있을 수 있으며, 조건을 만족하는 표식이 없다면 0을 출력한다. 각 표식은 정확히 한 번만 확인해야 한다.",
        input: "첫째 줄에 표식의 수 N과 기준 정수 K가 주어진다. 둘째 줄에 N개의 정수 A가 공백으로 구분되어 주어진다.",
        output: "K로 나누어떨어지는 모든 표식 값의 합을 정수 하나로 출력한다.",
        constraints: [
            "1 ≤ N ≤ 200,000",
            "1 ≤ K ≤ 1,000,000",
            "-1,000,000,000 ≤ Aᵢ ≤ 1,000,000,000",
        ],
        primaryTag: "구현",
        secondaryTags: ["배열", "누적 합"],
        functionSpec: {
            name: "sumDivisible",
            parameters: [
                { name: "values", type: "long[]" },
                { name: "divisor", type: "long" },
            ],
            returnType: "long",
        },
        samples: [
            {
                input: "sumDivisible([3, 5, -6, 8, 12, 1], 3)",
                output: "9",
                arguments: [[3, 5, -6, 8, 12, 1], 3],
                expected: 9,
            },
            {
                input: "sumDivisible([-4, -3, 0, 10], 2)",
                output: "6",
                arguments: [[-4, -3, 0, 10], 2],
                expected: 6,
            },
            {
                input: "sumDivisible([100, -50, 2], 1)",
                output: "52",
                arguments: [[100, -50, 2], 1],
                expected: 52,
            },
        ],
        hiddenTests: [
            { input: "sumDivisible([5], 7)", output: "0", arguments: [[5], 7], expected: 0 },
            { input: "sumDivisible([0], 5)", output: "0", arguments: [[0], 5], expected: 0 },
            {
                input: "sumDivisible([-9, 9], 3)",
                output: "0",
                arguments: [[-9, 9], 3],
                expected: 0,
            },
            {
                input: "sumDivisible([7, 14, 21], 7)",
                output: "42",
                arguments: [[7, 14, 21], 7],
                expected: 42,
            },
            {
                input: "sumDivisible([1000000000, 1], 2)",
                output: "1000000000",
                arguments: [[1000000000, 1], 2],
                expected: 1000000000,
            },
        ],
        explanation:
            "수열을 한 번 순회하면서 각 값의 K에 대한 나머지가 0인지 검사한다. 조건을 만족하는 값만 64비트 정수 합계에 더한다. 시간 복잡도는 O(N), 추가 공간 복잡도는 O(1)이다.",
        solutions: {
            python: "def sumDivisible(values, divisor):\n    return sum(value for value in values if value % divisor == 0)",
            java: "static long sumDivisible(long[] values, long divisor) { long sum = 0; for (long value : values) if (value % divisor == 0) sum += value; return sum; }",
            javascript:
                "const sumDivisible = (values, divisor) => values.reduce((sum, value) => value % divisor === 0 ? sum + value : sum, 0);",
            cpp: "long long sumDivisible(vector<long long> values, long long divisor) { long long sum = 0; for (long long value : values) if (value % divisor == 0) sum += value; return sum; }",
        },
        oracle: "def oracle(values, k):\n return sum(value for value in values if value % k == 0)",
    });
}

function twoSumCandidate(request: GenerationRequest): ProblemPackage {
    return problemPackageSchema.parse({
        ...base(request),
        title: "두 조약돌의 무게",
        statement:
            "서로 다른 위치에 놓인 조약돌 N개의 무게가 주어진다. 알고달은 정확히 두 개를 골라 무게의 합을 목표값 T로 만들 수 있는지 확인하려 한다. 같은 조약돌을 두 번 고를 수 없고, 가능한 쌍이 하나라도 있으면 YES를 출력한다.",
        input: "첫째 줄에 조약돌 수 N과 목표값 T가 주어진다. 둘째 줄에 N개의 조약돌 무게가 주어진다.",
        output: "서로 다른 두 조약돌의 합이 T이면 YES, 그렇지 않으면 NO를 출력한다.",
        constraints: ["2 ≤ N ≤ 200,000", "각 무게와 T의 절댓값은 1,000,000,000 이하"],
        primaryTag: "해시",
        secondaryTags: ["배열"],
        functionSpec: {
            name: "hasTwoSum",
            parameters: [
                { name: "values", type: "long[]" },
                { name: "target", type: "long" },
            ],
            returnType: "boolean",
        },
        samples: [
            {
                input: "hasTwoSum([2, 7, 4, 1, 8], 9)",
                output: "true",
                arguments: [[2, 7, 4, 1, 8], 9],
                expected: true,
            },
            {
                input: "hasTwoSum([4, 1, 2], 8)",
                output: "false",
                arguments: [[4, 1, 2], 8],
                expected: false,
            },
            {
                input: "hasTwoSum([-3, 7, 3, 9], 0)",
                output: "true",
                arguments: [[-3, 7, 3, 9], 0],
                expected: true,
            },
        ],
        hiddenTests: [
            {
                input: "hasTwoSum([5, 5], 10)",
                output: "true",
                arguments: [[5, 5], 10],
                expected: true,
            },
            {
                input: "hasTwoSum([1, 2], 4)",
                output: "false",
                arguments: [[1, 2], 4],
                expected: false,
            },
            {
                input: "hasTwoSum([-5, -2, -7], -9)",
                output: "true",
                arguments: [[-5, -2, -7], -9],
                expected: true,
            },
            {
                input: "hasTwoSum([0, 1, 2], 0)",
                output: "false",
                arguments: [[0, 1, 2], 0],
                expected: false,
            },
            {
                input: "hasTwoSum([1000000000, -1000000000], 0)",
                output: "true",
                arguments: [[1000000000, -1000000000], 0],
                expected: true,
            },
        ],
        explanation:
            "앞에서 확인한 무게를 집합에 저장한다. 현재 값 x를 볼 때 T-x가 집합에 있으면 서로 다른 두 위치의 쌍을 찾은 것이다. 시간 복잡도와 공간 복잡도는 각각 O(N)이다.",
        solutions: {
            python: "def hasTwoSum(values, target):\n    seen = set()\n    for value in values:\n        if target - value in seen: return True\n        seen.add(value)\n    return False",
            java: "static boolean hasTwoSum(long[] values, long target) { java.util.Set<Long> seen = new java.util.HashSet<>(); for (long value : values) { if (seen.contains(target - value)) return true; seen.add(value); } return false; }",
            javascript:
                "const hasTwoSum = (values, target) => { const seen = new Set(); for (const value of values) { if (seen.has(target - value)) return true; seen.add(value); } return false; };",
            cpp: "bool hasTwoSum(vector<long long> values, long long target) { unordered_set<long long> seen; for (long long value : values) { if (seen.count(target - value)) return true; seen.insert(value); } return false; }",
        },
        oracle: "def oracle(values, target):\n seen=set()\n for value in values:\n  if target-value in seen:return True\n  seen.add(value)\n return False",
    });
}

function maximumSubarrayCandidate(request: GenerationRequest): ProblemPackage {
    return problemPackageSchema.parse({
        ...base(request),
        title: "연속된 물길의 최고 점수",
        statement:
            "초원의 물길은 N개 구간으로 이어져 있고 각 구간에는 양수 또는 음수 점수가 있다. 알고달은 비어 있지 않은 연속 구간 하나를 선택해 점수 합을 최대로 만들려고 한다. 선택한 구간은 중간을 건너뛸 수 없다.",
        input: "첫째 줄에 구간 수 N이 주어진다. 둘째 줄에 N개의 구간 점수가 순서대로 주어진다.",
        output: "비어 있지 않은 연속 구간의 합 중 최댓값을 출력한다.",
        constraints: ["1 ≤ N ≤ 200,000", "-1,000,000,000 ≤ Aᵢ ≤ 1,000,000,000"],
        primaryTag: "동적 계획법",
        secondaryTags: ["카데인 알고리즘"],
        functionSpec: {
            name: "maxSubarray",
            parameters: [{ name: "values", type: "long[]" }],
            returnType: "long",
        },
        samples: [
            {
                input: "maxSubarray([-2, 3, -1, 5, -6, 2, 4, -3])",
                output: "7",
                arguments: [[-2, 3, -1, 5, -6, 2, 4, -3]],
                expected: 7,
            },
            {
                input: "maxSubarray([-5, -2, -9, -3])",
                output: "-2",
                arguments: [[-5, -2, -9, -3]],
                expected: -2,
            },
            {
                input: "maxSubarray([1, 2, 3, 4, 5])",
                output: "15",
                arguments: [[1, 2, 3, 4, 5]],
                expected: 15,
            },
        ],
        hiddenTests: [
            { input: "maxSubarray([-7])", output: "-7", arguments: [[-7]], expected: -7 },
            { input: "maxSubarray([0])", output: "0", arguments: [[0]], expected: 0 },
            { input: "maxSubarray([5, -1, 5])", output: "9", arguments: [[5, -1, 5]], expected: 9 },
            {
                input: "maxSubarray([-1, 2, -1])",
                output: "2",
                arguments: [[-1, 2, -1]],
                expected: 2,
            },
            {
                input: "maxSubarray([1000000000, 1000000000])",
                output: "2000000000",
                arguments: [[1000000000, 1000000000]],
                expected: 2000000000,
            },
        ],
        explanation:
            "현재 위치에서 끝나는 최댓값은 현재 값만 새로 선택하는 경우와 이전 연속 합에 현재 값을 붙이는 경우 중 큰 값이다. 이를 전체 최댓값과 함께 갱신하면 O(N) 시간과 O(1) 공간으로 해결된다.",
        solutions: {
            python: "def maxSubarray(values):\n    current = best = values[0]\n    for value in values[1:]:\n        current = max(value, current + value)\n        best = max(best, current)\n    return best",
            java: "static long maxSubarray(long[] values) { long current = values[0], best = current; for (int i = 1; i < values.length; i++) { current = Math.max(values[i], current + values[i]); best = Math.max(best, current); } return best; }",
            javascript:
                "const maxSubarray = (values) => { let current = values[0], best = current; for (let i = 1; i < values.length; i++) { current = Math.max(values[i], current + values[i]); best = Math.max(best, current); } return best; };",
            cpp: "long long maxSubarray(vector<long long> values) { long long current = values[0], best = current; for (size_t i = 1; i < values.size(); i++) { current = max(values[i], current + values[i]); best = max(best, current); } return best; }",
        },
        oracle: "def oracle(values):\n current=best=values[0]\n for value in values[1:]:\n  current=max(value,current+value);best=max(best,current)\n return best",
    });
}
