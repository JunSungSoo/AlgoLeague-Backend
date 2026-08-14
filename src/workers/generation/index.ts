import Redis from "ioredis";
import { generateCandidate, type GenerationProvider, type GenerationRequest } from "./generator";
import { validatePackage } from "./validator";
import {
    claimGenerationJob,
    completeGenerationJob,
    findPublishedDuplicate,
    rejectGenerationJob,
} from "./publisher";
import { enqueueScheduledGeneration, generationSchedule } from "./scheduler";
import { dayjs } from "../../lib/dayjs-config";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});
const schedule = generationSchedule();
console.log(
    `generation worker ready; tiered schedule at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} KST`,
);
while (true) {
    await enqueueScheduledGeneration(redis);
    const item = await redis.brpop("generation:requested", 60);
    if (!item) continue;
    const job = JSON.parse(item[1]) as GenerationRequest & { id: string; champions?: boolean };
    if (!(await claimGenerationJob(job.id))) continue;
    try {
        const excluded = new Set<GenerationProvider>();
        const retryCounts = new Map<GenerationProvider, number>();
        let blueprint = job.blueprint;
        let generated;
        let report;
        while (true) {
            generated = await generateCandidate({ ...job, blueprint }, excluded);
            const duplicate = await findPublishedDuplicate(generated.candidate);
            if (duplicate) {
                const retries = (retryCounts.get(generated.provider) ?? 0) + 1;
                retryCounts.set(generated.provider, retries);
                blueprint = `${job.blueprint}. 기존 공개 문제 '${duplicate.title}'과 제목·내용·풀이 발상이 겹치지 않는 완전히 다른 문제를 작성하라`;
                if (retries < 3) continue;
                excluded.add(generated.provider);
                continue;
            }
            report = await validatePackage(generated.candidate);
            if (report.failures.length === 0) break;
            const retries = (retryCounts.get(generated.provider) ?? 0) + 1;
            retryCounts.set(generated.provider, retries);
            blueprint = `${job.blueprint}. 이전 후보가 자동 검증에 실패했다: ${report.failures.join(", ")}. 이 오류를 모두 피한 새 문제를 작성하라`;
            if (retries < 3) continue;
            excluded.add(generated.provider);
        }
        const state = await completeGenerationJob(
            job.id,
            generated.candidate,
            report,
            job.champions,
            generated.provider,
            generated.model,
        );
        await redis.hset(`generation:${job.id}`, {
            state,
            provider: generated.provider,
            model: generated.model,
            package: JSON.stringify(generated.candidate),
            report: JSON.stringify(report),
            updatedAt: dayjs().toISOString(),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        await rejectGenerationJob(job.id, "REJECTED_SCHEMA", reason);
        await redis.hset(`generation:${job.id}`, {
            state: "REJECTED_SCHEMA",
            failureReason: reason,
            updatedAt: dayjs().toISOString(),
        });
    }
}
