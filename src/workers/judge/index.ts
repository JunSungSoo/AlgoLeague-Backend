import Redis from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { problems, submissions, testCases } from "../../db/schema";
import {
    buildFunctionHarness,
    expectedFunctionOutput,
    type FunctionSpec,
} from "../../domain/function-spec";
import { recordAcceptedSubmission } from "../../services/grade-service";
import { compareOutput, type JudgeLanguage } from "../../domain/judge";
import { dayjs } from "../../lib/dayjs-config";
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
    const [problem] = await db
        .select({
            executionMode: problems.executionMode,
            functionSpec: problems.functionSpec,
            timeLimitMs: problems.timeLimitMs,
        })
        .from(problems)
        .where(eq(problems.id, submission.problemId))
        .limit(1);
    if (!problem) continue;
    const tests = await db
        .select()
        .from(testCases)
        .where(eq(testCases.problemId, submission.problemId));
    await redis.hset(`judge:${job.id}`, { verdict: "RN", updatedAt: dayjs().toISOString() });
    await db.update(submissions).set({ verdict: "RN" }).where(eq(submissions.id, job.id));
    let verdict = "AC";
    let durationMs = 0;
    let message = "";
    for (const test of tests) {
        let source = submission.sourceCode;
        let input = test.input;
        let expected = test.expectedOutput;
        if (problem.executionMode === "function") {
            if (!problem.functionSpec || !test.argumentsJson || test.expectedValue === null) {
                verdict = "IE";
                message = "함수 테스트 명세가 누락되었습니다.";
                break;
            }
            source = buildFunctionHarness(
                submission.language as JudgeLanguage,
                source,
                problem.functionSpec as FunctionSpec,
                test.argumentsJson,
            );
            input = "";
            expected = expectedFunctionOutput(test.expectedValue);
        }
        const result = await runSandbox(
            submission.language as JudgeLanguage,
            source,
            input,
            problem.timeLimitMs,
            submission.runtimeVersion,
        );
        durationMs += result.durationMs;
        if (result.verdict !== "AC") {
            verdict = result.verdict;
            message = result.stderr;
            break;
        }
        if (!compareOutput(result.stdout, expected)) {
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
            judgedAt: dayjs().toDate(),
        })
        .where(eq(submissions.id, job.id));
    if (verdict === "AC") await recordAcceptedSubmission(job.id);
    await redis.hset(`judge:${job.id}`, {
        verdict,
        durationMs: Math.round(durationMs),
        message,
        updatedAt: dayjs().toISOString(),
    });
    await redis.expire(`judge:${job.id}`, 86_400);
}
