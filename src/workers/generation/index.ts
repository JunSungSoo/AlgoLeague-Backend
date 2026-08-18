import Redis from "ioredis";
import type { GenerationRequest } from "./generator";
import { enqueueScheduledGeneration, generationSchedule } from "./scheduler";
import { dayjs } from "../../lib/dayjs-config";
import { processGenerationJob } from "./process-job";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});
const WORKER_HEARTBEAT_KEY = "generation:worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SECONDS = 90;
const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
const updateHeartbeat = () =>
    redis.set(WORKER_HEARTBEAT_KEY, dayjs().toISOString(), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
await updateHeartbeat();
const heartbeatTimer = setInterval(
    () =>
        void updateHeartbeat().catch((error) =>
            console.error("generation heartbeat failed", error),
        ),
    WORKER_HEARTBEAT_INTERVAL_MS,
);
heartbeatTimer.unref();
const schedule = generationSchedule();
console.log(
    `generation worker ready; tiered schedule at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} KST`,
);
while (true) {
    await enqueueScheduledGeneration(redis);
    const item = await redis.brpop("generation:requested", 60);
    if (!item) continue;
    const job = JSON.parse(item[1]) as GenerationRequest & { id: string; champions?: boolean };
    try {
        await processGenerationJob(redis, job);
    } finally {
        await redis.del(`generation:enqueue:${job.id}`);
    }
}
