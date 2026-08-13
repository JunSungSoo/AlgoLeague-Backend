import Redis from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { submissions, testCases } from "../../db/schema";
import { recordAcceptedSubmission } from "../../services/grade-service";
import { compareOutput, type JudgeLanguage } from "../../domain/judge";
import { runSandbox } from "./sandbox";

type Job = { id: string };
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

console.log("judge worker ready");
while (true) {
    const item = await redis.brpop("judge:queued", 0);
    if (!item) continue;
    const job = JSON.parse(item[1]) as Job;
    const [submission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, job.id))
        .limit(1);
    if (!submission) continue;
    const tests = await db
        .select()
        .from(testCases)
        .where(eq(testCases.problemId, submission.problemId));
    await redis.hset(`judge:${job.id}`, { verdict: "RN", updatedAt: new Date().toISOString() });
    await db.update(submissions).set({ verdict: "RN" }).where(eq(submissions.id, job.id));
    let verdict = "AC";
    let durationMs = 0;
    let message = "";
    for (const test of tests) {
        const result = await runSandbox(
            submission.language as JudgeLanguage,
            submission.sourceCode,
            test.input,
        );
        durationMs += result.durationMs;
        if (result.verdict !== "AC") {
            verdict = result.verdict;
            message = result.stderr;
            break;
        }
        if (!compareOutput(result.stdout, test.expectedOutput)) {
            verdict = "WA";
            break;
        }
    }
    await db
        .update(submissions)
        .set({
            verdict: verdict as typeof submissions.$inferInsert.verdict,
            runtimeMs: Math.round(durationMs),
            errorMessage: message || null,
            judgedAt: new Date(),
        })
        .where(eq(submissions.id, job.id));
    if (verdict === "AC") await recordAcceptedSubmission(job.id);
    await redis.hset(`judge:${job.id}`, {
        verdict,
        durationMs: Math.round(durationMs),
        message,
        updatedAt: new Date().toISOString(),
    });
    await redis.expire(`judge:${job.id}`, 86_400);
}
