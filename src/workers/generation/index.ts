import Redis from "ioredis";
import { generateCandidate, type GenerationProvider, type GenerationRequest } from "./generator";
import { validatePackage } from "./validator";
import { claimGenerationJob, completeGenerationJob, rejectGenerationJob } from "./publisher";
import { enqueueScheduledGeneration, generationSchedule } from "./scheduler";

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
        let generated;
        let report;
        while (true) {
            generated = await generateCandidate(job, excluded);
            report = await validatePackage(generated.candidate);
            if (report.failures.length === 0) break;
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
            updatedAt: new Date().toISOString(),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        await rejectGenerationJob(job.id, "REJECTED_SCHEMA", reason);
        await redis.hset(`generation:${job.id}`, {
            state: "REJECTED_SCHEMA",
            failureReason: reason,
            updatedAt: new Date().toISOString(),
        });
    }
}
