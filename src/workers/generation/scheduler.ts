import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { db } from "../../db";
import { generationJobs } from "../../db/schema";
import type { GenerationRequest } from "./generator";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_HOUR = 0;
const DEFAULT_MINUTE = 5;
const DEFAULT_MEDIUM_WEEKDAYS = "1,3,5";
const DEFAULT_ELITE_WEEKDAYS = "0";

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function generationSchedule(now = new Date()) {
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    const day = kst.toISOString().slice(0, 10);
    const hour = integerSetting(process.env.GENERATION_DAILY_HOUR_KST, DEFAULT_HOUR, 0, 23);
    const minute = integerSetting(process.env.GENERATION_DAILY_MINUTE_KST, DEFAULT_MINUTE, 0, 59);
    return {
        day,
        weekday: kst.getUTCDay(),
        hour,
        minute,
        due:
            kst.getUTCHours() > hour ||
            (kst.getUTCHours() === hour && kst.getUTCMinutes() >= minute),
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
    now = new Date(),
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
        return "elite-grade-1: 국제 대회 결승 수준의 독창적인 복합 알고리즘 문제. 최소 두 가지 고급 알고리즘을 결합하고 단순 완전탐색이나 알려진 문제의 변형을 금지한다";
    if (grade <= 3)
        return `advanced-grade-${grade}: 고급 자료구조 또는 동적 계획법·그래프 최적화가 필요한 문제`;
    return `core-grade-${grade}: 해당 급수 학습자가 핵심 알고리즘을 훈련할 수 있는 문제`;
}

export async function enqueueScheduledGeneration(redis: Redis, now = new Date()) {
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
                    .set({ state: "REQUESTED", failureReason: null, updatedAt: new Date() })
                    .where(eq(generationJobs.id, job.id))
                    .returning();
                await redis.del(`generation:enqueue:${job.id}`);
            }
            const retryKey = `generation:enqueue:${job.id}`;
            if ((await redis.set(retryKey, "1", "EX", 300, "NX")) !== "OK") return;
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
