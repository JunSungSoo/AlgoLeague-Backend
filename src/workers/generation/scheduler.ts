import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { db } from "../../db";
import { generationJobs } from "../../db/schema";
import { dayjs } from "../../lib/dayjs-config";
import type { GenerationRequest } from "./generator";

const DEFAULT_HOUR = 0;
const DEFAULT_MINUTE = 5;
const DEFAULT_MEDIUM_WEEKDAYS = "1,3,5";
const DEFAULT_ELITE_WEEKDAYS = "0";

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function generationSchedule(now = dayjs().toDate()) {
    const kst = dayjs(now).tz();
    const day = kst.format("YYYY-MM-DD");
    const hour = integerSetting(process.env.GENERATION_DAILY_HOUR_KST, DEFAULT_HOUR, 0, 23);
    const minute = integerSetting(process.env.GENERATION_DAILY_MINUTE_KST, DEFAULT_MINUTE, 0, 59);
    return {
        day,
        weekday: kst.day(),
        hour,
        minute,
        due: kst.hour() > hour || (kst.hour() === hour && kst.minute() >= minute),
    };
}

function weekdays(value: string | undefined, fallback: string) {
    const parsed = (value ?? fallback)
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    return new Set(parsed.length ? parsed : fallback.split(",").map(Number));
}

export function scheduledGrades(
    now = dayjs().toDate(),
    mediumDays = process.env.GENERATION_MEDIUM_WEEKDAYS_KST,
    eliteDays = process.env.GENERATION_ELITE_WEEKDAYS_KST,
) {
    const { weekday } = generationSchedule(now);
    const grades = [4, 5, 6, 7, 8, 9];
    if (weekdays(mediumDays, DEFAULT_MEDIUM_WEEKDAYS).has(weekday)) grades.unshift(2, 3);
    if (weekdays(eliteDays, DEFAULT_ELITE_WEEKDAYS).has(weekday)) grades.unshift(1);
    return grades;
}

export function generationBlueprint(grade: number) {
    if (grade === 1)
        return "research-calibrated-grade-1: LeetCode Hard 상단·Codewars 1~2 kyu에 대응하는 국제 대회 결승 수준. 고급 알고리즘 두 가지 이상을 결합하고 비자명한 정당성 증명과 최적화가 필요해야 한다. 단순 템플릿 적용, 알려진 문제의 수치·서사 변형, 완전탐색 통과를 금지한다";
    if (grade === 2)
        return "research-calibrated-grade-2: LeetCode Hard·Codewars 2~3 kyu 수준. 상태 확장 최단 경로·고급 동적 계획법·고급 자료구조 중 두 요소를 결합하고 표준 템플릿만으로 해결되지 않게 한다";
    if (grade === 3)
        return "research-calibrated-grade-3: LeetCode Hard 입문·Codewars 3~4 kyu 수준. 세그먼트 트리·오프라인 분리 집합·트리 동적 계획법 중 하나와 별도의 관찰 또는 전처리를 결합해야 한다";
    if (grade === 4)
        return "research-calibrated-grade-4: LeetCode Medium 상단·Codewars 4 kyu 수준. 최단 경로·위상 정렬·상태 동적 계획법 중 하나가 필수이며 단순 BFS나 1차원 점화식으로 낮아지지 않아야 한다";
    if (grade === 5)
        return "research-calibrated-grade-5: LeetCode Medium·Codewars 5 kyu 수준. 그리디·구간 처리·단조 스택·큐 중 하나를 선택하고 선택의 정당성 또는 불변식을 설명해야 한다";
    if (grade === 6)
        return "research-calibrated-grade-6: LeetCode Medium 입문·Codewars 5~6 kyu 수준. BFS/DFS·슬라이딩 윈도·이분 탐색 중 하나를 정확히 적용해야 하며 단순 순회나 정렬만으로 풀 수 없어야 한다";
    if (grade === 7)
        return "research-calibrated-grade-7: LeetCode Easy 상단~Medium 입문·Codewars 6 kyu 수준. 투 포인터·누적 합·해시·이분 탐색으로 명백한 O(N²) 완전탐색을 O(N log N) 또는 O(N)으로 개선해야 한다";
    if (grade === 8)
        return "research-calibrated-grade-8: LeetCode Easy·Codewars 6~7 kyu 수준. 배열이나 문자열을 탐색하며 빈도·해시·정렬 중 하나를 사용하고 최소 한 가지 경계 조건을 정확히 처리해야 한다";
    return "research-calibrated-grade-9: LeetCode Easy 초반·Codewars 7 kyu 수준. 배열 또는 문자열을 한 번 이상 탐색하며 위치·연속 구간·빈도 상태를 관리해야 한다. 단순 사칙연산, 값 하나의 공식 계산, 조건문 한 번으로 해결되는 문제는 금지한다";
}

export async function enqueueScheduledGeneration(redis: Redis, now = dayjs().toDate()) {
    const schedule = generationSchedule(now);
    if (!schedule.due) return 0;
    const numericDay = Number(schedule.day.replaceAll("-", ""));
    let queued = 0;
    for (const grade of scheduledGrades(now)) {
        const seed = numericDay * 100 + grade;
        const blueprintVersion = `daily-${schedule.day}`;
        await db.transaction(async (tx) => {
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtext(${`generation:${grade}:${seed}`}))`,
            );
            let [job] = await tx
                .select()
                .from(generationJobs)
                .where(
                    and(
                        eq(generationJobs.grade, grade),
                        eq(generationJobs.seed, seed),
                        eq(generationJobs.blueprintVersion, blueprintVersion),
                    ),
                )
                .limit(1);
            if (!job)
                [job] = await tx
                    .insert(generationJobs)
                    .values({
                        id: randomUUID(),
                        state: "REQUESTED",
                        grade,
                        blueprintVersion,
                        promptVersion: "schedule-v3",
                        model: process.env.GENERATION_PROVIDERS ?? "openai,openrouter,ollama,rule",
                        seed,
                    })
                    .returning();
            const sandboxFailure =
                job.state === "REJECTED_WEAK_TESTS" &&
                Array.isArray((job.report as { failures?: unknown } | null)?.failures) &&
                (job.report as { failures: string[] }).failures.some((failure) =>
                    failure.includes("JH"),
                );
            const generatorFailure = job.state === "REJECTED_SCHEMA";
            const retryableFailure = sandboxFailure || generatorFailure;
            if (job.state !== "REQUESTED" && !retryableFailure) return;
            if (retryableFailure) {
                [job] = await tx
                    .update(generationJobs)
                    .set({
                        state: "REQUESTED",
                        failureReason: null,
                        updatedAt: dayjs().toDate(),
                    })
                    .where(eq(generationJobs.id, job.id))
                    .returning();
                await redis.del(`generation:enqueue:${job.id}`);
            }
            const retryKey = `generation:enqueue:${job.id}`;
            if ((await redis.set(retryKey, "1", "NX")) !== "OK") return;
            const request: GenerationRequest & { id: string; champions: boolean } = {
                id: job.id,
                grade,
                blueprint: generationBlueprint(grade),
                blueprintVersion,
                seed,
                champions: false,
            };
            await redis.lpush("generation:requested", JSON.stringify(request));
            queued += 1;
        });
    }
    return queued;
}

export const enqueueDailyGeneration = enqueueScheduledGeneration;
