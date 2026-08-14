import { problemPackageSchema, type ProblemPackage } from "../../domain/generation";
import type { FunctionTestValue } from "../../domain/function-spec";
import type { GenerationRequest } from "./generator";

type Solve = (args: FunctionTestValue[]) => FunctionTestValue;

const commonStatement =
    "입력의 순서와 각 값의 의미는 모두 중요하며 임의로 재배열하거나 일부를 생략할 수 없다. 모든 조건을 만족하는 정확한 결과를 반환해야 한다. 입력 크기의 최댓값에서도 제한 시간 안에 동작하도록 명시된 알고리즘 복잡도를 지켜야 하며, 예제에만 맞춘 구현은 허용되지 않는다.";

function tests(name: string, cases: FunctionTestValue[][], solve: Solve) {
    return cases.map((arguments_) => {
        const expected = solve(arguments_);
        return {
            input: `${name}(${arguments_.map((value) => JSON.stringify(value)).join(", ")})`,
            output: JSON.stringify(expected),
            arguments: arguments_,
            expected,
        };
    });
}

function pack(
    request: GenerationRequest,
    data: Omit<
        ProblemPackage,
        "grade" | "generatorSeed" | "blueprintVersion" | "samples" | "hiddenTests"
    > & {
        cases: FunctionTestValue[][];
        solve: Solve;
    },
) {
    const allTests = tests(data.functionSpec.name, data.cases, data.solve);
    const { cases: _cases, solve: _solve, ...problem } = data;
    void _cases;
    void _solve;
    return problemPackageSchema.parse({
        ...problem,
        statement: `${problem.statement} ${commonStatement}`,
        grade: request.grade,
        generatorSeed: request.seed,
        blueprintVersion: request.blueprintVersion,
        samples: allTests.slice(0, 3),
        hiddenTests: allTests.slice(3),
    });
}

export function curatedCandidate(request: GenerationRequest): ProblemPackage {
    const factories = [
        gradeOne,
        gradeTwo,
        gradeThree,
        gradeFour,
        gradeFive,
        gradeSix,
        gradeSeven,
        gradeEight,
        gradeNine,
    ];
    const factory = factories[request.grade - 1];
    if (!factory) throw new Error(`지원하지 않는 등급입니다: ${request.grade}`);
    return factory(request);
}

function gradeNine(request: GenerationRequest) {
    const solve: Solve = ([raw]) => {
        const values = raw as number[];
        let best = 1;
        let run = 1;
        for (let index = 1; index < values.length; index++) {
            run = values[index]! > values[index - 1]! ? run + 1 : 1;
            best = Math.max(best, run);
        }
        return best;
    };
    return pack(request, {
        title: "가장 긴 오르막 물길",
        statement:
            "알고달은 순서대로 이어진 물길의 높이를 조사한다. 바로 앞 구간보다 높이가 엄격히 커지는 구간이 연속해서 몇 개까지 이어지는지 구하라. 같은 높이는 오르막을 끊으며, 답에는 시작 구간도 포함한다.",
        input: "정수 배열 heights가 물길의 높이를 진행 순서대로 담아 함수에 전달된다.",
        output: "엄격히 증가하는 가장 긴 연속 부분 배열의 길이를 정수로 반환한다.",
        constraints: [
            "1 ≤ heights.length ≤ 200,000",
            "-10^9 ≤ heights[i] ≤ 10^9",
            "의도한 시간 복잡도 O(N)",
        ],
        primaryTag: "탐색",
        secondaryTags: ["배열", "상태 관리"],
        functionSpec: {
            name: "longestClimb",
            parameters: [{ name: "heights", type: "long[]" }],
            returnType: "integer",
        },
        cases: [
            [[1, 2, 3, 1, 2]],
            [[5, 4, 3]],
            [[2, 2, 3, 4]],
            [[7]],
            [[-3, -2, -1, 0]],
            [[1, 3, 2, 4, 6, 8]],
            [[4, 4, 4]],
            [[9, 1, 2, 3, 0]],
            [[-1, -2]],
            [[1, 2]],
            [[3, 1, 2, 0, 1, 2, 3]],
        ],
        solve,
        explanation:
            "왼쪽부터 한 번 순회하며 현재 위치에서 끝나는 엄격한 오르막 길이를 유지한다. 현재 높이가 이전 높이보다 크면 길이를 1 늘리고, 그렇지 않으면 1로 초기화한다. 순회 중 최댓값을 갱신하므로 시간 복잡도는 O(N), 추가 공간은 O(1)이다.",
        solutions: {
            python: "def longestClimb(heights):\n    best = run = 1\n    for i in range(1, len(heights)):\n        run = run + 1 if heights[i] > heights[i-1] else 1\n        best = max(best, run)\n    return best",
            java: "public static int longestClimb(long[] heights) { int best=1, run=1; for(int i=1;i<heights.length;i++){ run=heights[i]>heights[i-1]?run+1:1; best=Math.max(best,run); } return best; }",
            javascript:
                "function longestClimb(heights) { let best=1, run=1; for(let i=1;i<heights.length;i++){ run=heights[i]>heights[i-1]?run+1:1; best=Math.max(best,run); } return best; }",
            cpp: "int longestClimb(vector<long long> heights) { int best=1, run=1; for(int i=1;i<(int)heights.size();i++){ run=heights[i]>heights[i-1]?run+1:1; best=max(best,run); } return best; }",
        },
        oracle: "배열을 순회하면서 직전 값보다 커지는 연속 길이와 그 최댓값을 계산한다.",
    });
}

function gradeEight(request: GenerationRequest) {
    const solve: Solve = ([raw]) => {
        const text = raw as string;
        const count = new Map<string, number>();
        for (const ch of text) count.set(ch, (count.get(ch) ?? 0) + 1);
        for (let index = 0; index < text.length; index++)
            if (count.get(text[index]!) === 1) return index;
        return -1;
    };
    return pack(request, {
        title: "처음 나타난 외로운 문자",
        statement:
            "문자열을 왼쪽부터 읽을 때 전체 문자열에서 단 한 번만 등장하는 문자 가운데 가장 앞선 위치를 찾는다. 반복되는 문자는 서로 떨어져 있어도 모두 제외하며, 조건을 만족하는 문자가 없다면 -1을 반환한다.",
        input: "영문 소문자로 이루어진 문자열 text 하나가 함수 인자로 전달된다.",
        output: "전체에서 한 번만 등장하는 첫 문자의 0부터 시작하는 인덱스 또는 -1을 반환한다.",
        constraints: [
            "1 ≤ text.length ≤ 200,000",
            "text는 영문 소문자로만 구성",
            "의도한 시간 복잡도 O(N)",
        ],
        primaryTag: "해시",
        secondaryTags: ["문자열", "빈도"],
        functionSpec: {
            name: "firstUniqueIndex",
            parameters: [{ name: "text", type: "string" }],
            returnType: "integer",
        },
        cases: [
            ["algoleague"],
            ["aabbcc"],
            ["swiss"],
            ["z"],
            ["aab"],
            ["abac"],
            ["zzxyyx"],
            ["abcabcq"],
            ["aaaaab"],
            ["leetcode"],
            ["xxyzzw"],
        ],
        solve,
        explanation:
            "첫 순회에서 해시 맵에 각 문자의 전체 등장 횟수를 기록한다. 두 번째 순회에서 횟수가 1인 첫 위치를 즉시 반환한다. 두 번의 선형 순회만 사용하므로 시간 복잡도는 O(N), 서로 다른 문자 수에 비례하는 공간을 사용한다.",
        solutions: {
            python: "def firstUniqueIndex(text):\n    count = {}\n    for ch in text: count[ch] = count.get(ch, 0) + 1\n    for i, ch in enumerate(text):\n        if count[ch] == 1: return i\n    return -1",
            java: "public static int firstUniqueIndex(String text) { int[] count=new int[26]; for(char c:text.toCharArray()) count[c-'a']++; for(int i=0;i<text.length();i++) if(count[text.charAt(i)-'a']==1) return i; return -1; }",
            javascript:
                "function firstUniqueIndex(text) { const count=new Map(); for(const ch of text) count.set(ch,(count.get(ch)||0)+1); for(let i=0;i<text.length;i++) if(count.get(text[i])===1) return i; return -1; }",
            cpp: "int firstUniqueIndex(string text) { int count[26]={}; for(char c:text) count[c-'a']++; for(int i=0;i<(int)text.size();i++) if(count[text[i]-'a']==1) return i; return -1; }",
        },
        oracle: "전체 문자 빈도를 센 뒤 왼쪽부터 빈도가 하나인 최초 위치를 탐색한다.",
    });
}

function gradeSeven(request: GenerationRequest) {
    const solve: Solve = ([raw, rawTarget]) => {
        const values = raw as number[];
        const target = rawTarget as number;
        const count = new Map<number, number>([[0, 1]]);
        let prefix = 0;
        let answer = 0;
        for (const value of values) {
            prefix += value;
            answer += count.get(prefix - target) ?? 0;
            count.set(prefix, (count.get(prefix) ?? 0) + 1);
        }
        return answer;
    };
    return pack(request, {
        title: "목표 합을 만드는 연속 구간",
        statement:
            "음수와 0을 포함할 수 있는 정수 배열에서 합이 정확히 target인 비어 있지 않은 연속 부분 배열의 개수를 구한다. 시작점이나 끝점이 다르면 별개의 구간이며, 원소를 건너뛴 선택은 허용되지 않는다.",
        input: "정수 배열 values와 목표 정수 target이 함수 인자로 전달된다.",
        output: "합이 target인 모든 연속 부분 배열의 개수를 64비트 정수로 반환한다.",
        constraints: [
            "1 ≤ values.length ≤ 200,000",
            "|values[i]|, |target| ≤ 10^9",
            "의도한 시간 복잡도 O(N)",
        ],
        primaryTag: "누적 합",
        secondaryTags: ["해시", "배열"],
        functionSpec: {
            name: "countTargetRanges",
            parameters: [
                { name: "values", type: "long[]" },
                { name: "target", type: "long" },
            ],
            returnType: "long",
        },
        cases: [
            [[1, 1, 1], 2],
            [[1, -1, 0], 0],
            [[3, 4, 7, 2, -3, 1, 4, 2], 7],
            [[5], 5],
            [[5], 0],
            [[0, 0, 0], 0],
            [[-1, -1, 1], -1],
            [[2, -2, 2, -2], 0],
            [[1, 2, 3], 3],
            [[-3, 1, 2, -3, 3], 0],
            [[10, -10, 10], 10],
        ],
        solve,
        explanation:
            "현재 누적 합이 P일 때 이전 누적 합이 P-target인 지점마다 하나의 정답 구간이 생긴다. 해시 맵에 지금까지 나온 누적 합의 빈도를 저장하고 순서대로 더한다. 음수가 있어도 성립하며 시간 O(N), 공간 O(N)이다.",
        solutions: {
            python: "def countTargetRanges(values, target):\n    count={0:1}; prefix=answer=0\n    for value in values:\n        prefix+=value; answer+=count.get(prefix-target,0); count[prefix]=count.get(prefix,0)+1\n    return answer",
            java: "public static long countTargetRanges(long[] values, long target) { java.util.Map<Long,Long> count=new java.util.HashMap<>(); count.put(0L,1L); long prefix=0,answer=0; for(long value:values){ prefix+=value; answer+=count.getOrDefault(prefix-target,0L); count.put(prefix,count.getOrDefault(prefix,0L)+1); } return answer; }",
            javascript:
                "function countTargetRanges(values,target){ const count=new Map([[0,1]]); let prefix=0,answer=0; for(const value of values){ prefix+=value; answer+=count.get(prefix-target)||0; count.set(prefix,(count.get(prefix)||0)+1); } return answer; }",
            cpp: "long long countTargetRanges(vector<long long> values,long long target){ unordered_map<long long,long long> count; count[0]=1; long long prefix=0,answer=0; for(long long value:values){ prefix+=value; answer+=count[prefix-target]; count[prefix]++; } return answer; }",
        },
        oracle: "누적 합 빈도 해시를 이용해 현재 누적 합과 목표값의 차이가 등장한 횟수를 합산한다.",
    });
}

function gradeSix(request: GenerationRequest) {
    const solve: Solve = ([raw, rawDays]) => {
        const weights = raw as number[];
        const days = rawDays as number;
        let low = Math.max(...weights),
            high = weights.reduce((a, b) => a + b, 0);
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            let used = 1,
                sum = 0;
            for (const w of weights) {
                if (sum + w > mid) {
                    used++;
                    sum = 0;
                }
                sum += w;
            }
            if (used <= days) high = mid;
            else low = mid + 1;
        }
        return low;
    };
    return pack(request, {
        title: "수달 우편선의 최소 용량",
        statement:
            "순서가 고정된 짐을 매일 앞에서부터 연속으로 실어 정해진 days일 안에 모두 운반하려 한다. 한 짐을 나눌 수 없고 매일 실은 총무게는 선박 용량을 넘을 수 없다. 가능한 최소 용량을 구하라.",
        input: "양의 정수 배열 weights와 사용할 수 있는 날짜 수 days가 함수 인자로 전달된다.",
        output: "모든 짐을 순서대로 days일 이내 운반할 수 있는 최소 선박 용량을 반환한다.",
        constraints: [
            "1 ≤ weights.length ≤ 200,000",
            "1 ≤ weights[i] ≤ 10^9",
            "1 ≤ days ≤ weights.length",
            "의도한 시간 복잡도 O(N log(sum(weights)))",
        ],
        primaryTag: "이분 탐색",
        secondaryTags: ["매개변수 탐색", "그리디"],
        functionSpec: {
            name: "minimumCapacity",
            parameters: [
                { name: "weights", type: "long[]" },
                { name: "days", type: "integer" },
            ],
            returnType: "long",
        },
        cases: [
            [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5],
            [[3, 2, 2, 4, 1, 4], 3],
            [[1, 2, 3, 1, 1], 4],
            [[7], 1],
            [[5, 5, 5], 3],
            [[5, 5, 5], 1],
            [[10, 1, 1, 1], 2],
            [[2, 8, 2, 8], 2],
            [[1, 1, 1, 1], 2],
            [[9, 8, 7, 6], 3],
            [[100, 1, 1, 1, 1], 4],
        ],
        solve,
        explanation:
            "용량이 커질수록 필요한 날짜 수는 단조 감소한다. 하한을 가장 무거운 짐, 상한을 전체 합으로 두고 용량을 이분 탐색한다. 각 후보 용량은 순서대로 최대한 싣는 그리디로 필요한 날짜를 O(N)에 계산하므로 전체 시간은 O(N log S)이다.",
        solutions: {
            python: "def minimumCapacity(weights, days):\n    low, high=max(weights),sum(weights)\n    while low<high:\n        mid=(low+high)//2; used=1; total=0\n        for w in weights:\n            if total+w>mid: used+=1; total=0\n            total+=w\n        if used<=days: high=mid\n        else: low=mid+1\n    return low",
            java: "public static long minimumCapacity(long[] weights,int days){ long low=0,high=0; for(long w:weights){low=Math.max(low,w);high+=w;} while(low<high){long mid=(low+high)/2,total=0;int used=1;for(long w:weights){if(total+w>mid){used++;total=0;}total+=w;}if(used<=days)high=mid;else low=mid+1;}return low;}",
            javascript:
                "function minimumCapacity(weights,days){let low=Math.max(...weights),high=weights.reduce((a,b)=>a+b,0);while(low<high){const mid=Math.floor((low+high)/2);let used=1,total=0;for(const w of weights){if(total+w>mid){used++;total=0;}total+=w;}if(used<=days)high=mid;else low=mid+1;}return low;}",
            cpp: "long long minimumCapacity(vector<long long> weights,int days){long long low=*max_element(weights.begin(),weights.end()),high=accumulate(weights.begin(),weights.end(),0LL);while(low<high){long long mid=(low+high)/2,total=0;int used=1;for(long long w:weights){if(total+w>mid){used++;total=0;}total+=w;}if(used<=days)high=mid;else low=mid+1;}return low;}",
        },
        oracle: "가능 용량에 대한 단조성을 이용해 이분 탐색하고 매 후보를 순차 적재로 검사한다.",
    });
}

function gradeFive(request: GenerationRequest) {
    const MOD = 1_000_000_007;
    const solve: Solve = ([raw]) => {
        const values = raw as number[];
        const stack: number[] = [];
        let answer = 0;
        for (let i = 0; i <= values.length; i++) {
            const current = i === values.length ? -1 : values[i]!;
            while (stack.length && values[stack[stack.length - 1]!]! > current) {
                const mid = stack.pop()!;
                const left = stack.length ? stack[stack.length - 1]! : -1;
                answer = (answer + values[mid]! * (mid - left) * (i - mid)) % MOD;
            }
            stack.push(i);
        }
        return answer;
    };
    return pack(request, {
        title: "모든 물결 구간의 최솟값 합",
        statement:
            "양의 정수 배열의 모든 비어 있지 않은 연속 부분 배열을 생각한다. 각 부분 배열에서 가장 작은 값을 하나 고르고, 그렇게 얻은 최솟값을 모두 더한 결과를 구한다. 값이 같은 원소가 여러 개여도 각 구간은 정확히 한 번만 세어야 한다.",
        input: "양의 정수 배열 values 하나가 함수의 인자로 전달된다.",
        output: "모든 연속 부분 배열 최솟값의 합을 1,000,000,007로 나눈 나머지를 반환한다.",
        constraints: [
            "1 ≤ values.length ≤ 200,000",
            "1 ≤ values[i] ≤ 10^9",
            "의도한 시간 복잡도 O(N)",
        ],
        primaryTag: "단조 스택",
        secondaryTags: ["기여도", "배열"],
        functionSpec: {
            name: "sumSubarrayMinimums",
            parameters: [{ name: "values", type: "long[]" }],
            returnType: "long",
        },
        cases: [
            [[3, 1, 2, 4]],
            [[11, 81, 94, 43, 3]],
            [[1]],
            [[1, 2]],
            [[2, 1]],
            [[2, 2]],
            [[5, 4, 3, 2, 1]],
            [[1, 2, 3, 4, 5]],
            [[2, 1, 2]],
            [[7, 7, 7]],
            [[4, 2, 5, 1, 3]],
        ],
        solve,
        explanation:
            "각 원소가 최솟값이 되는 구간 수를 계산한다. 단조 증가 스택에서 원소가 빠질 때 왼쪽의 이전 이하 원소와 오른쪽의 최초 미만 원소까지 거리를 곱하면 그 원소의 기여 횟수가 된다. 같은 값의 귀속 방향을 일관되게 정해 중복을 막으며 시간 O(N), 공간 O(N)이다.",
        solutions: {
            python: "def sumSubarrayMinimums(values):\n    mod=1000000007; stack=[]; answer=0\n    for i in range(len(values)+1):\n        current=-1 if i==len(values) else values[i]\n        while stack and values[stack[-1]]>current:\n            mid=stack.pop(); left=stack[-1] if stack else -1; answer=(answer+values[mid]*(mid-left)*(i-mid))%mod\n        stack.append(i)\n    return answer",
            java: "public static long sumSubarrayMinimums(long[] values){long mod=1000000007L,answer=0;java.util.ArrayDeque<Integer>s=new java.util.ArrayDeque<>();for(int i=0;i<=values.length;i++){long cur=i==values.length?-1:values[i];while(!s.isEmpty()&&values[s.peek()]>cur){int mid=s.pop(),left=s.isEmpty()?-1:s.peek();answer=(answer+(values[mid]%mod)*(mid-left)%mod*(i-mid))%mod;}s.push(i);}return answer;}",
            javascript:
                "function sumSubarrayMinimums(values){const mod=1000000007,stack=[];let answer=0;for(let i=0;i<=values.length;i++){const cur=i===values.length?-1:values[i];while(stack.length&&values[stack.at(-1)]>cur){const mid=stack.pop(),left=stack.length?stack.at(-1):-1;answer=(answer+((values[mid]*(mid-left))%mod)*(i-mid))%mod;}stack.push(i);}return answer;}",
            cpp: "long long sumSubarrayMinimums(vector<long long> values){const long long mod=1000000007;vector<int>s;long long answer=0;for(int i=0;i<=(int)values.size();i++){long long cur=i==(int)values.size()?-1:values[i];while(!s.empty()&&values[s.back()]>cur){int mid=s.back();s.pop_back();int left=s.empty()?-1:s.back();answer=(answer+(values[mid]%mod)*(mid-left)%mod*(i-mid))%mod;}s.push_back(i);}return answer;}",
        },
        oracle: "단조 스택으로 각 값이 구간 최솟값이 되는 왼쪽과 오른쪽 경계를 찾아 기여도를 합한다.",
    });
}

function gradeFour(request: GenerationRequest) {
    const solve: Solve = ([a, b, c]) => {
        const starts = a as number[],
            ends = b as number[],
            profits = c as number[];
        const jobs = starts
            .map((s, i) => [s, ends[i]!, profits[i]!] as number[])
            .sort((x, y) => x[1]! - y[1]!);
        const finish = jobs.map((x) => x[1]!);
        const dp = [0];
        for (let i = 0; i < jobs.length; i++) {
            let l = 0,
                r = i;
            while (l < r) {
                const m = Math.ceil((l + r) / 2);
                if (finish[m - 1]! <= jobs[i]![0]!) l = m;
                else r = m - 1;
            }
            dp.push(Math.max(dp[i]!, dp[l]! + jobs[i]![2]!));
        }
        return dp[jobs.length]!;
    };
    return pack(request, {
        title: "겹치지 않는 의뢰의 최고 보상",
        statement:
            "각 의뢰에는 시작 시각, 종료 시각, 보상이 있다. 한 수달은 동시에 하나의 의뢰만 수행할 수 있으며 종료 시각과 다음 시작 시각이 같으면 연속 수행할 수 있다. 서로 겹치지 않는 의뢰들을 골라 얻는 보상의 최댓값을 구하라.",
        input: "같은 길이의 정수 배열 starts, ends, profits가 각 의뢰의 시작, 종료, 보상을 나타낸다.",
        output: "시간이 겹치지 않게 선택할 수 있는 의뢰 보상 합의 최댓값을 반환한다.",
        constraints: [
            "1 ≤ 의뢰 수 ≤ 200,000",
            "0 ≤ starts[i] < ends[i] ≤ 10^9",
            "1 ≤ profits[i] ≤ 10^9",
            "의도한 시간 복잡도 O(N log N)",
        ],
        primaryTag: "동적 계획법",
        secondaryTags: ["이분 탐색", "구간"],
        functionSpec: {
            name: "maximumContractProfit",
            parameters: [
                { name: "starts", type: "long[]" },
                { name: "ends", type: "long[]" },
                { name: "profits", type: "long[]" },
            ],
            returnType: "long",
        },
        cases: [
            [
                [1, 2, 3, 3],
                [3, 4, 5, 6],
                [50, 10, 40, 70],
            ],
            [
                [1, 2, 3, 4, 6],
                [3, 5, 10, 6, 9],
                [20, 20, 100, 70, 60],
            ],
            [[1], [2], [5]],
            [
                [1, 2],
                [2, 3],
                [4, 5],
            ],
            [
                [1, 1],
                [3, 2],
                [10, 20],
            ],
            [
                [1, 3, 5],
                [3, 5, 7],
                [10, 20, 30],
            ],
            [
                [1, 2, 4],
                [10, 3, 5],
                [100, 10, 10],
            ],
            [
                [0, 5, 10],
                [5, 10, 15],
                [7, 8, 9],
            ],
            [
                [1, 4, 2],
                [4, 7, 5],
                [5, 6, 100],
            ],
            [
                [2, 2, 2],
                [3, 4, 5],
                [1, 2, 3],
            ],
            [
                [1, 5, 6, 7],
                [4, 6, 7, 8],
                [8, 9, 10, 11],
            ],
        ],
        solve,
        explanation:
            "의뢰를 종료 시각으로 정렬하고 dp[i]를 앞의 i개 의뢰로 얻는 최대 보상으로 둔다. i번째 의뢰를 선택할 때 시작 시각 이하로 끝나는 마지막 위치를 이분 탐색해 그 dp와 보상을 더한다. 선택하지 않는 경우와 비교하므로 O(N log N) 시간과 O(N) 공간이 필요하다.",
        solutions: {
            python: "def maximumContractProfit(starts,ends,profits):\n import bisect\n jobs=sorted(zip(ends,starts,profits)); finish=[];dp=[0]\n for e,s,p in jobs:\n  j=bisect.bisect_right(finish,s);dp.append(max(dp[-1],dp[j]+p));finish.append(e)\n return dp[-1]",
            java: "public static long maximumContractProfit(long[] starts,long[] ends,long[] profits){Integer[]o=new Integer[starts.length];for(int i=0;i<o.length;i++)o[i]=i;java.util.Arrays.sort(o,(x,y)->Long.compare(ends[x],ends[y]));long[]f=new long[o.length],dp=new long[o.length+1];for(int i=0;i<o.length;i++){int id=o[i];f[i]=ends[id];int l=0,r=i;while(l<r){int m=(l+r+1)/2;if(f[m-1]<=starts[id])l=m;else r=m-1;}dp[i+1]=Math.max(dp[i],dp[l]+profits[id]);}return dp[o.length];}",
            javascript:
                "function maximumContractProfit(starts,ends,profits){const jobs=starts.map((s,i)=>[s,ends[i],profits[i]]).sort((a,b)=>a[1]-b[1]),f=jobs.map(x=>x[1]),dp=[0];for(let i=0;i<jobs.length;i++){let l=0,r=i;while(l<r){const m=Math.ceil((l+r)/2);if(f[m-1]<=jobs[i][0])l=m;else r=m-1;}dp.push(Math.max(dp[i],dp[l]+jobs[i][2]));}return dp.at(-1);}",
            cpp: "long long maximumContractProfit(vector<long long> starts,vector<long long> ends,vector<long long> profits){vector<array<long long,3>>j;for(int i=0;i<(int)starts.size();i++)j.push_back({ends[i],starts[i],profits[i]});sort(j.begin(),j.end());vector<long long>f,dp(1);for(auto x:j){int k=upper_bound(f.begin(),f.end(),x[1])-f.begin();dp.push_back(max(dp.back(),dp[k]+x[2]));f.push_back(x[0]);}return dp.back();}",
        },
        oracle: "종료 시각 정렬과 이전 호환 의뢰 이분 탐색을 결합한 가중 구간 스케줄링 동적 계획법을 사용한다.",
    });
}

function gradeThree(request: GenerationRequest) {
    const solve: Solve = ([raw, lo, hi]) => {
        const a = raw as number[],
            lower = lo as number,
            upper = hi as number,
            p = [0];
        for (const x of a) p.push(p[p.length - 1]! + x);
        function rec(l: number, r: number): number {
            if (r - l <= 1) return 0;
            const m = (l + r) >> 1;
            let ans = rec(l, m) + rec(m, r),
                x = m,
                y = m;
            for (let i = l; i < m; i++) {
                while (x < r && p[x]! - p[i]! < lower) x++;
                while (y < r && p[y]! - p[i]! <= upper) y++;
                ans += y - x;
            }
            const merged = p.slice(l, r).sort((u, v) => u - v);
            for (let i = 0; i < merged.length; i++) p[l + i] = merged[i]!;
            return ans;
        }
        return rec(0, p.length);
    };
    return pack(request, {
        title: "허용 범위에 든 구간 합의 수",
        statement:
            "정수 배열의 모든 연속 부분 배열 가운데 원소 합이 lower 이상 upper 이하인 구간의 개수를 구한다. 배열에는 큰 음수와 양수가 함께 존재할 수 있어 투 포인터의 단조성을 사용할 수 없으며, 서로 다른 시작점과 끝점은 별개의 구간이다.",
        input: "정수 배열 values와 두 정수 lower, upper가 함수에 전달되며 lower는 upper 이하이다.",
        output: "합이 닫힌 구간 [lower, upper]에 포함되는 연속 부분 배열의 개수를 반환한다.",
        constraints: [
            "1 ≤ values.length ≤ 100,000",
            "|values[i]|, |lower|, |upper| ≤ 10^9",
            "의도한 시간 복잡도 O(N log N)",
        ],
        primaryTag: "분할 정복",
        secondaryTags: ["누적 합", "병합 정렬"],
        functionSpec: {
            name: "countBoundedRangeSums",
            parameters: [
                { name: "values", type: "long[]" },
                { name: "lower", type: "long" },
                { name: "upper", type: "long" },
            ],
            returnType: "long",
        },
        cases: [
            [[-2, 5, -1], -2, 2],
            [[0], 0, 0],
            [[1, -1, 1], 0, 1],
            [[3], 1, 2],
            [[-3], -5, -2],
            [[1, 2, 3], 3, 5],
            [[0, 0, 0], 0, 0],
            [[-1, -1, -1], -2, -1],
            [[5, -2, 4, -1], 3, 6],
            [[2, -2, 2, -2], -1, 1],
            [[10, -10, 5], 5, 10],
        ],
        solve,
        explanation:
            "누적 합 P를 만들면 구간 합은 두 누적 합의 차이다. 누적 합 배열을 반으로 나누어 각 절반의 답을 재귀적으로 센 뒤, 왼쪽 값마다 오른쪽 정렬 구간에서 차이가 lower 이상인 첫 위치와 upper 초과인 첫 위치를 두 포인터로 찾는다. 병합 정렬 구조로 O(N log N)이다.",
        solutions: {
            python: "def countBoundedRangeSums(values,lower,upper):\n p=[0]\n for x in values:p.append(p[-1]+x)\n def rec(a):\n  if len(a)<=1:return 0,a\n  m=len(a)//2;x,l=rec(a[:m]);y,r=rec(a[m:]);ans=x+y;i=j=0\n  for v in l:\n   while i<len(r) and r[i]-v<lower:i+=1\n   while j<len(r) and r[j]-v<=upper:j+=1\n   ans+=j-i\n  return ans,sorted(l+r)\n return rec(p)[0]",
            java: "public static long countBoundedRangeSums(long[]v,long lo,long hi){long[]p=new long[v.length+1];for(int i=0;i<v.length;i++)p[i+1]=p[i]+v[i];return cr(p,0,p.length,lo,hi);}static long cr(long[]p,int l,int r,long lo,long hi){if(r-l<=1)return 0;int m=(l+r)/2;long a=cr(p,l,m,lo,hi)+cr(p,m,r,lo,hi);int x=m,y=m;for(int i=l;i<m;i++){while(x<r&&p[x]-p[i]<lo)x++;while(y<r&&p[y]-p[i]<=hi)y++;a+=y-x;}long[]t=new long[r-l];int i=l,j=m,k=0;while(i<m||j<r)t[k++]=j==r||(i<m&&p[i]<=p[j])?p[i++]:p[j++];System.arraycopy(t,0,p,l,t.length);return a;}",
            javascript:
                "function countBoundedRangeSums(v,lo,hi){const p=[0];for(const x of v)p.push(p.at(-1)+x);function rec(l,r){if(r-l<=1)return 0;const m=(l+r)>>1;let a=rec(l,m)+rec(m,r),x=m,y=m;for(let i=l;i<m;i++){while(x<r&&p[x]-p[i]<lo)x++;while(y<r&&p[y]-p[i]<=hi)y++;a+=y-x;}const t=p.slice(l,r).sort((a,b)=>a-b);for(let i=0;i<t.length;i++)p[l+i]=t[i];return a;}return rec(0,p.length);}",
            cpp: "long long crs(vector<long long>&p,int l,int r,long long lo,long long hi){if(r-l<=1)return 0;int m=(l+r)/2,x=m,y=m;long long a=crs(p,l,m,lo,hi)+crs(p,m,r,lo,hi);for(int i=l;i<m;i++){while(x<r&&p[x]-p[i]<lo)x++;while(y<r&&p[y]-p[i]<=hi)y++;a+=y-x;}inplace_merge(p.begin()+l,p.begin()+m,p.begin()+r);return a;}long long countBoundedRangeSums(vector<long long>v,long long lo,long long hi){vector<long long>p(1);for(auto x:v)p.push_back(p.back()+x);return crs(p,0,p.size(),lo,hi);}",
        },
        oracle: "누적 합을 병합 정렬하는 분할 정복 과정에서 두 포인터로 허용 차이의 개수를 센다.",
    });
}

function gradeTwo(request: GenerationRequest) {
    const solve: Solve = ([raw, g]) => {
        const a = raw as number[],
            groups = g as number,
            p = [0];
        for (const x of a) p.push(p.at(-1)! + x);
        let dp = Array(a.length + 1).fill(Infinity);
        dp[0] = 0;
        for (let k = 1; k <= groups; k++) {
            const next = Array(a.length + 1).fill(Infinity);
            for (let i = k; i <= a.length; i++)
                for (let j = k - 1; j < i; j++)
                    next[i] = Math.min(next[i], dp[j] + (p[i] - p[j]) ** 2);
            dp = next;
        }
        return dp[a.length];
    };
    return pack(request, {
        title: "균형 잡힌 연속 훈련 구간",
        statement:
            "양의 훈련 강도 배열을 순서를 유지한 채 정확히 groups개의 비어 있지 않은 연속 구간으로 나눈다. 한 구간의 피로도는 그 구간 강도 합의 제곱이며, 모든 구간 피로도의 합을 최소화해야 한다. 경계 선택에 따른 전역 최적값을 구하라.",
        input: "양의 정수 배열 values와 만들 구간 수 groups가 함수 인자로 전달된다.",
        output: "정확히 groups개 연속 구간으로 나눴을 때 피로도 합의 최솟값을 64비트 정수로 반환한다.",
        constraints: [
            "1 ≤ groups ≤ values.length ≤ 600",
            "1 ≤ values[i] ≤ 1,000",
            "의도한 시간 복잡도 O(groups × N²)",
            "64비트 정수 사용",
        ],
        primaryTag: "동적 계획법",
        secondaryTags: ["구간 분할", "누적 합"],
        functionSpec: {
            name: "minimumPartitionFatigue",
            parameters: [
                { name: "values", type: "long[]" },
                { name: "groups", type: "integer" },
            ],
            returnType: "long",
        },
        cases: [
            [[1, 2, 3, 4], 2],
            [[5, 5, 5], 3],
            [[1, 1, 1, 1], 1],
            [[7], 1],
            [[1, 2], 2],
            [[2, 3, 1], 2],
            [[10, 1, 1, 10], 2],
            [[1, 3, 2, 4, 1], 3],
            [[4, 4, 4, 4], 2],
            [[1, 2, 3, 4, 5], 4],
            [[9, 1, 2, 8, 3], 2],
        ],
        solve,
        explanation:
            "누적 합으로 임의 구간 합을 O(1)에 구한다. dp[k][i]를 앞의 i개 원소를 k개 구간으로 나눈 최소 피로도로 정의하고, 마지막 구간이 j부터 i-1까지인 모든 경계를 비교한다. 상태의 최적 부분 구조가 성립하며 시간 O(groups·N²), 롤링 배열 공간 O(N)을 사용한다.",
        solutions: {
            python: "def minimumPartitionFatigue(values,groups):\n p=[0]\n for x in values:p.append(p[-1]+x)\n inf=10**30;dp=[inf]*(len(values)+1);dp[0]=0\n for k in range(1,groups+1):\n  nd=[inf]*(len(values)+1)\n  for i in range(k,len(values)+1):\n   for j in range(k-1,i):nd[i]=min(nd[i],dp[j]+(p[i]-p[j])**2)\n  dp=nd\n return dp[-1]",
            java: "public static long minimumPartitionFatigue(long[]v,int groups){int n=v.length;long[]p=new long[n+1];for(int i=0;i<n;i++)p[i+1]=p[i]+v[i];long inf=Long.MAX_VALUE/4;long[]dp=new long[n+1];java.util.Arrays.fill(dp,inf);dp[0]=0;for(int k=1;k<=groups;k++){long[]nd=new long[n+1];java.util.Arrays.fill(nd,inf);for(int i=k;i<=n;i++)for(int j=k-1;j<i;j++){long s=p[i]-p[j];nd[i]=Math.min(nd[i],dp[j]+s*s);}dp=nd;}return dp[n];}",
            javascript:
                "function minimumPartitionFatigue(v,groups){const p=[0];for(const x of v)p.push(p.at(-1)+x);let dp=Array(v.length+1).fill(Infinity);dp[0]=0;for(let k=1;k<=groups;k++){const nd=Array(v.length+1).fill(Infinity);for(let i=k;i<=v.length;i++)for(let j=k-1;j<i;j++)nd[i]=Math.min(nd[i],dp[j]+(p[i]-p[j])**2);dp=nd;}return dp[v.length];}",
            cpp: "long long minimumPartitionFatigue(vector<long long>v,int groups){int n=v.size();vector<long long>p(n+1),dp(n+1,LLONG_MAX/4);for(int i=0;i<n;i++)p[i+1]=p[i]+v[i];dp[0]=0;for(int k=1;k<=groups;k++){vector<long long>nd(n+1,LLONG_MAX/4);for(int i=k;i<=n;i++)for(int j=k-1;j<i;j++){long long s=p[i]-p[j];nd[i]=min(nd[i],dp[j]+s*s);}dp.swap(nd);}return dp[n];}",
        },
        oracle: "누적 합과 구간 분할 동적 계획법으로 마지막 경계의 모든 가능성을 비교해 전역 최솟값을 구한다.",
    });
}

function gradeOne(request: GenerationRequest) {
    const solve: Solve = ([rn, rf, rt, rc, rr]) => {
        const n = rn as number,
            from = rf as number[],
            to = rt as number[],
            cost = rc as number[],
            req = rr as number[],
            INF = 1e15;
        const d: number[][] = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? 0 : INF)),
        );
        for (let i = 0; i < from.length; i++) {
            d[from[i]!]![to[i]!] = Math.min(d[from[i]!]![to[i]!]!, cost[i]!);
            d[to[i]!]![from[i]!] = Math.min(d[to[i]!]![from[i]!]!, cost[i]!);
        }
        for (let k = 0; k < n; k++)
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) d[i]![j] = Math.min(d[i]![j]!, d[i]![k]! + d[k]![j]!);
        const m = req.length,
            size = 1 << m,
            dp = Array.from({ length: size }, () => Array(m).fill(INF));
        for (let i = 0; i < m; i++) dp[1 << i]![i] = d[0]![req[i]!]!;
        for (let mask = 1; mask < size; mask++)
            for (let i = 0; i < m; i++)
                if ((mask >> i) & 1)
                    for (let j = 0; j < m; j++)
                        if (!((mask >> j) & 1))
                            dp[mask | (1 << j)]![j] = Math.min(
                                dp[mask | (1 << j)]![j]!,
                                dp[mask]![i]! + d[req[i]!]![req[j]!]!,
                            );
        let ans = INF;
        for (let i = 0; i < m; i++) ans = Math.min(ans, dp[size - 1]![i]! + d[req[i]!]![0]!);
        return ans;
    };
    return pack(request, {
        title: "왕국 순찰의 최단 완주 경로",
        statement:
            "양방향 가중 그래프의 0번 마을에서 출발해 required에 적힌 모든 핵심 마을을 각각 한 번 이상 방문한 뒤 다시 0번 마을로 돌아오려 한다. 핵심 마을 사이를 이동할 때 다른 마을을 지나도 되며 같은 일반 마을과 간선을 여러 번 사용할 수 있다. 가능한 최소 총비용을 구하라.",
        input: "마을 수 n, 간선의 양 끝점 배열 from과 to, 양의 비용 배열 cost, 중복 없는 핵심 마을 배열 required가 함수에 전달된다.",
        output: "0번 마을에서 출발해 모든 핵심 마을을 방문하고 돌아오는 최소 비용을 반환한다.",
        constraints: [
            "2 ≤ n ≤ 60",
            "1 ≤ 간선 수 ≤ 2,000",
            "1 ≤ required.length ≤ 15",
            "모든 핵심 마을은 0이 아니며 그래프는 연결됨",
            "의도한 시간 복잡도 O(N³ + 2^K·K²)",
        ],
        primaryTag: "비트마스크 동적 계획법",
        secondaryTags: ["플로이드-워셜", "최단 경로", "상태 압축"],
        functionSpec: {
            name: "minimumKingdomTour",
            parameters: [
                { name: "n", type: "integer" },
                { name: "from", type: "integer[]" },
                { name: "to", type: "integer[]" },
                { name: "cost", type: "long[]" },
                { name: "required", type: "integer[]" },
            ],
            returnType: "long",
        },
        cases: [
            [4, [0, 1, 2, 0], [1, 2, 3, 3], [2, 2, 2, 10], [1, 3]],
            [3, [0, 1, 0], [1, 2, 2], [5, 6, 20], [2]],
            [5, [0, 1, 2, 3, 4], [1, 2, 3, 4, 0], [1, 1, 1, 1, 10], [2, 4]],
            [2, [0], [1], [7], [1]],
            [4, [0, 0, 1, 2], [1, 2, 3, 3], [1, 5, 1, 1], [2, 3]],
            [5, [0, 1, 2, 3, 0], [1, 2, 3, 4, 4], [3, 3, 3, 3, 20], [1, 4]],
            [4, [0, 1, 0, 2, 1], [1, 3, 2, 3, 2], [10, 10, 1, 1, 1], [1, 3]],
            [6, [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 0], [2, 2, 2, 2, 2, 2], [2, 4, 5]],
            [3, [0, 1, 0], [1, 2, 2], [1, 1, 10], [1, 2]],
            [5, [0, 0, 1, 2, 3], [1, 2, 3, 3, 4], [4, 2, 1, 5, 1], [1, 4]],
            [4, [0, 1, 2, 3, 0], [1, 2, 3, 0, 2], [5, 1, 1, 5, 2], [1, 2, 3]],
        ],
        solve,
        explanation:
            "먼저 플로이드-워셜로 모든 마을 쌍의 최단 거리를 구해 핵심 마을 사이 이동을 압축한다. 이후 dp[mask][i]를 mask의 핵심 마을을 방문하고 i에서 끝난 최소 비용으로 정의해 방문하지 않은 마을을 추가한다. 마지막에 0번으로 돌아오는 비용을 더한다. 두 알고리즘을 결합한 복잡도는 O(N³+2^K·K²)이다.",
        solutions: {
            python: "def minimumKingdomTour(n,fr,to,cost,required):\n inf=10**18;d=[[inf]*n for _ in range(n)]\n for i in range(n):d[i][i]=0\n for a,b,c in zip(fr,to,cost):d[a][b]=d[b][a]=min(d[a][b],c)\n for k in range(n):\n  for i in range(n):\n   for j in range(n):d[i][j]=min(d[i][j],d[i][k]+d[k][j])\n m=len(required);dp=[[inf]*m for _ in range(1<<m)]\n for i,x in enumerate(required):dp[1<<i][i]=d[0][x]\n for mask in range(1<<m):\n  for i in range(m):\n   if mask>>i&1:\n    for j in range(m):\n     if not mask>>j&1:dp[mask|1<<j][j]=min(dp[mask|1<<j][j],dp[mask][i]+d[required[i]][required[j]])\n return min(dp[-1][i]+d[required[i]][0] for i in range(m))",
            java: "public static long minimumKingdomTour(int n,int[]fr,int[]to,long[]cost,int[]req){long I=Long.MAX_VALUE/4;long[][]d=new long[n][n];for(int i=0;i<n;i++){java.util.Arrays.fill(d[i],I);d[i][i]=0;}for(int i=0;i<fr.length;i++)d[fr[i]][to[i]]=d[to[i]][fr[i]]=Math.min(d[fr[i]][to[i]],cost[i]);for(int k=0;k<n;k++)for(int i=0;i<n;i++)for(int j=0;j<n;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);int m=req.length;long[][]dp=new long[1<<m][m];for(long[]x:dp)java.util.Arrays.fill(x,I);for(int i=0;i<m;i++)dp[1<<i][i]=d[0][req[i]];for(int s=1;s<1<<m;s++)for(int i=0;i<m;i++)if((s>>i&1)>0)for(int j=0;j<m;j++)if((s>>j&1)==0)dp[s|1<<j][j]=Math.min(dp[s|1<<j][j],dp[s][i]+d[req[i]][req[j]]);long a=I;for(int i=0;i<m;i++)a=Math.min(a,dp[(1<<m)-1][i]+d[req[i]][0]);return a;}",
            javascript:
                "function minimumKingdomTour(n,fr,to,cost,req){const I=1e15,d=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:I));for(let i=0;i<fr.length;i++)d[fr[i]][to[i]]=d[to[i]][fr[i]]=Math.min(d[fr[i]][to[i]],cost[i]);for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);const m=req.length,dp=Array.from({length:1<<m},()=>Array(m).fill(I));for(let i=0;i<m;i++)dp[1<<i][i]=d[0][req[i]];for(let s=1;s<1<<m;s++)for(let i=0;i<m;i++)if(s>>i&1)for(let j=0;j<m;j++)if(!(s>>j&1))dp[s|1<<j][j]=Math.min(dp[s|1<<j][j],dp[s][i]+d[req[i]][req[j]]);return Math.min(...dp.at(-1).map((x,i)=>x+d[req[i]][0]));}",
            cpp: "long long minimumKingdomTour(int n,vector<int>fr,vector<int>to,vector<long long>cost,vector<int>req){const long long I=4e18;vector<vector<long long>>d(n,vector<long long>(n,I));for(int i=0;i<n;i++)d[i][i]=0;for(int i=0;i<(int)fr.size();i++)d[fr[i]][to[i]]=d[to[i]][fr[i]]=min(d[fr[i]][to[i]],cost[i]);for(int k=0;k<n;k++)for(int i=0;i<n;i++)for(int j=0;j<n;j++)d[i][j]=min(d[i][j],d[i][k]+d[k][j]);int m=req.size();vector<vector<long long>>dp(1<<m,vector<long long>(m,I));for(int i=0;i<m;i++)dp[1<<i][i]=d[0][req[i]];for(int s=1;s<1<<m;s++)for(int i=0;i<m;i++)if(s>>i&1)for(int j=0;j<m;j++)if(!(s>>j&1))dp[s|1<<j][j]=min(dp[s|1<<j][j],dp[s][i]+d[req[i]][req[j]]);long long a=I;for(int i=0;i<m;i++)a=min(a,dp.back()[i]+d[req[i]][0]);return a;}",
        },
        oracle: "모든 쌍 최단 거리로 그래프를 압축한 뒤 핵심 마을 집합을 비트마스크 동적 계획법으로 순회한다.",
    });
}
