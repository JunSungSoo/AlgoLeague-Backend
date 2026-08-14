import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import Redis from "ioredis";
import { db, pool } from "../../db";
import { generationJobs } from "../../db/schema";
import { processGenerationJob, type QueuedGenerationJob } from "./process-job";
import { generationBlueprint } from "./scheduler";

const BATCH_VERSION = process.env.GENERATION_BATCH_VERSION ?? "research-calibrated-2026-08-14-v1";
const PROMPT_VERSION = "research-calibration-v1";
const FIRST_GRADE = 1;
const LAST_GRADE = 9;
const SEED_BASE = 26_081_400;
const RETRYABLE_STATES = ["REQUESTED", "GENERATING", "REJECTED_SCHEMA"] as const;

function selectedGrades() {
    const configured = (process.env.GENERATION_BATCH_GRADES ?? "")
        .split(",")
        .map(Number)
        .filter((grade) => Number.isInteger(grade) && grade >= FIRST_GRADE && grade <= LAST_GRADE);
    return new Set(configured.length ? configured : [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

async function registerBatch() {
    const jobs: QueuedGenerationJob[] = [];
    for (let grade = FIRST_GRADE; grade <= LAST_GRADE; grade++) {
        const seed = SEED_BASE + grade;
        let [job] = await db
            .select()
            .from(generationJobs)
            .where(
                and(
                    eq(generationJobs.grade, grade),
                    eq(generationJobs.seed, seed),
                    eq(generationJobs.blueprintVersion, BATCH_VERSION),
                ),
            )
            .limit(1);
        if (!job)
            [job] = await db
                .insert(generationJobs)
                .values({
                    id: randomUUID(),
                    state: "REQUESTED",
                    grade,
                    blueprintVersion: BATCH_VERSION,
                    promptVersion: PROMPT_VERSION,
                    model: process.env.GENERATION_PROVIDERS ?? "openrouter,ollama",
                    seed,
                })
                .returning();
        else if (RETRYABLE_STATES.includes(job.state as (typeof RETRYABLE_STATES)[number]))
            [job] = await db
                .update(generationJobs)
                .set({ state: "REQUESTED", failureReason: null })
                .where(
                    and(
                        eq(generationJobs.id, job.id),
                        inArray(generationJobs.state, [...RETRYABLE_STATES]),
                    ),
                )
                .returning();
        jobs.push({
            id: job.id,
            grade,
            blueprint: generationBlueprint(grade),
            blueprintVersion: BATCH_VERSION,
            seed,
            champions: false,
        });
    }
    return jobs;
}

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

try {
    const jobs = await registerBatch();
    const grades = selectedGrades();
    for (const job of jobs.reverse().filter((candidate) => grades.has(candidate.grade))) {
        console.log(`[${job.grade}급] 생성을 시작합니다: ${job.id}`);
        const state = await processGenerationJob(redis, job);
        console.log(`[${job.grade}급] 생성 결과: ${state}`);
    }
} finally {
    await redis.quit();
    await pool.end();
}
