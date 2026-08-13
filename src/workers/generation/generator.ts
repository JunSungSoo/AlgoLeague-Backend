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
    // 9~6급은 비용과 외부 장애에 영향받지 않는 규칙 기반 문제를 우선 사용한다.
    const configured = providerOrder();
    const gradeProviders =
        request.grade === 1
            ? configured.filter((provider) => provider !== "rule")
            : request.grade >= 6
              ? ([
                    "rule",
                    ...configured.filter((provider) => provider !== "rule"),
                ] as GenerationProvider[])
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
                const model = process.env.OPENROUTER_MODEL ?? "openrouter/free";
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
    return `한국어 알고리즘 문제 패키지를 새로 작성하라. 등급은 ${request.grade}급, 설계는 ${request.blueprint}, 버전은 ${request.blueprintVersion}, 시드는 ${request.seed}이다. 알려진 문제의 문장·캐릭터·예제를 복제하지 말라. Python, Java, JavaScript, C++17 정답은 표준 입력과 표준 출력을 사용해야 한다. 공개 예제 외에 경계값을 포함한 hiddenTests를 최소 5개 만들고 모든 출력은 정확해야 한다. generatorSeed와 blueprintVersion은 입력값을 그대로 사용하라. JSON 스키마만 출력하라.`;
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
    required: ["input", "output"],
    properties: { input: { type: "string" }, output: { type: "string" } },
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
        samples: { type: "array", items: testSchema },
        hiddenTests: { type: "array", items: testSchema },
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
        samples: [{ input: "6 3\n3 5 -6 8 12 1\n", output: "9\n" }],
        hiddenTests: [
            { input: "1 7\n5\n", output: "0\n" },
            { input: "4 2\n-4 -3 0 10\n", output: "6\n" },
            { input: "3 1\n100 -50 2\n", output: "52\n" },
        ],
        explanation:
            "수열을 한 번 순회하면서 각 값의 K에 대한 나머지가 0인지 검사한다. 조건을 만족하는 값만 64비트 정수 합계에 더한다. 시간 복잡도는 O(N), 추가 공간 복잡도는 O(1)이다.",
        solutions: {
            python: "import sys\nd=list(map(int,sys.stdin.buffer.read().split()));n,k=d[:2];print(sum(x for x in d[2:2+n] if x%k==0))",
            java: "import java.io.*;import java.util.*;public class Main{public static void main(String[]z)throws Exception{Scanner s=new Scanner(System.in);int n=s.nextInt();long k=s.nextLong(),a=0;for(int i=0;i<n;i++){long x=s.nextLong();if(x%k==0)a+=x;}System.out.println(a);}}",
            javascript:
                "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(BigInt),n=Number(d[0]),k=d[1];let s=0n;for(let i=0;i<n;i++)if(d[i+2]%k===0n)s+=d[i+2];console.log(String(s));",
            cpp: "#include <bits/stdc++.h>\nusing namespace std;int main(){ios::sync_with_stdio(false);cin.tie(nullptr);int n;long long k,x,s=0;cin>>n>>k;while(n--){cin>>x;if(x%k==0)s+=x;}cout<<s<<'\\n';}",
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
        samples: [{ input: "5 9\n2 7 4 1 8\n", output: "YES\n" }],
        hiddenTests: [
            { input: "2 10\n5 5\n", output: "YES\n" },
            { input: "3 8\n4 1 2\n", output: "NO\n" },
            { input: "4 0\n-3 7 3 9\n", output: "YES\n" },
        ],
        explanation:
            "앞에서 확인한 무게를 집합에 저장한다. 현재 값 x를 볼 때 T-x가 집합에 있으면 서로 다른 두 위치의 쌍을 찾은 것이다. 시간 복잡도와 공간 복잡도는 각각 O(N)이다.",
        solutions: {
            python: "import sys\nd=list(map(int,sys.stdin.buffer.read().split()));n,t=d[:2];s=set()\nfor x in d[2:2+n]:\n if t-x in s: print('YES');break\n s.add(x)\nelse: print('NO')",
            java: 'import java.io.*;import java.util.*;public class Main{public static void main(String[]a)throws Exception{Scanner s=new Scanner(System.in);int n=s.nextInt();long t=s.nextLong();Set<Long> q=new HashSet<>();for(int i=0;i<n;i++){long x=s.nextLong();if(q.contains(t-x)){System.out.println("YES");return;}q.add(x);}System.out.println("NO");}}',
            javascript:
                "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number),n=d[0],t=d[1],s=new Set();for(let i=0;i<n;i++){let x=d[i+2];if(s.has(t-x)){console.log('YES');process.exit()}s.add(x)}console.log('NO');",
            cpp: '#include <bits/stdc++.h>\nusing namespace std;int main(){ios::sync_with_stdio(false);cin.tie(nullptr);int n;long long t,x;cin>>n>>t;unordered_set<long long>s;while(n--){cin>>x;if(s.count(t-x)){cout<<"YES\\n";return 0;}s.insert(x);}cout<<"NO\\n";}',
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
        samples: [{ input: "8\n-2 3 -1 5 -6 2 4 -3\n", output: "7\n" }],
        hiddenTests: [
            { input: "1\n-7\n", output: "-7\n" },
            { input: "4\n-5 -2 -9 -3\n", output: "-2\n" },
            { input: "5\n1 2 3 4 5\n", output: "15\n" },
        ],
        explanation:
            "현재 위치에서 끝나는 최댓값은 현재 값만 새로 선택하는 경우와 이전 연속 합에 현재 값을 붙이는 경우 중 큰 값이다. 이를 전체 최댓값과 함께 갱신하면 O(N) 시간과 O(1) 공간으로 해결된다.",
        solutions: {
            python: "import sys\nd=list(map(int,sys.stdin.buffer.read().split()))[1:];cur=best=d[0]\nfor x in d[1:]:cur=max(x,cur+x);best=max(best,cur)\nprint(best)",
            java: "import java.io.*;import java.util.*;public class Main{public static void main(String[]z)throws Exception{Scanner s=new Scanner(System.in);int n=s.nextInt();long c=s.nextLong(),b=c;for(int i=1;i<n;i++){long x=s.nextLong();c=Math.max(x,c+x);b=Math.max(b,c);}System.out.println(b);}}",
            javascript:
                "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(BigInt),n=Number(d[0]);let c=d[1],b=c;for(let i=2;i<=n;i++){const x=d[i];c=x>c+x?x:c+x;b=b>c?b:c}console.log(String(b));",
            cpp: "#include <bits/stdc++.h>\nusing namespace std;int main(){ios::sync_with_stdio(false);cin.tie(nullptr);int n;long long x,c,b;cin>>n>>c;b=c;for(int i=1;i<n;i++){cin>>x;c=max(x,c+x);b=max(b,c);}cout<<b<<'\\n';}",
        },
        oracle: "def oracle(values):\n current=best=values[0]\n for value in values[1:]:\n  current=max(value,current+value);best=max(best,current)\n return best",
    });
}
