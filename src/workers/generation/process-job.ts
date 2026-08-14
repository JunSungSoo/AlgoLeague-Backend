import type Redis from "ioredis";
import { dayjs } from "../../lib/dayjs-config";
import { generateCandidate, type GenerationProvider, type GenerationRequest } from "./generator";
import {
    claimGenerationJob,
    completeGenerationJob,
    findPublishedDuplicate,
    rejectGenerationJob,
} from "./publisher";
import { validatePackage } from "./validator";

export type QueuedGenerationJob = GenerationRequest & {
    id: string;
    champions?: boolean;
};

export async function processGenerationJob(redis: Redis, job: QueuedGenerationJob) {
    if (!(await claimGenerationJob(job.id))) return "SKIPPED" as const;
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
            console.warn(
                `[${job.grade}급] ${generated.provider} 자동 검증 실패: ${report.failures.join(", ")}`,
            );
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
        return state;
    } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        await rejectGenerationJob(job.id, "REJECTED_SCHEMA", reason);
        await redis.hset(`generation:${job.id}`, {
            state: "REJECTED_SCHEMA",
            failureReason: reason,
            updatedAt: dayjs().toISOString(),
        });
        return "REJECTED_SCHEMA" as const;
    }
}
