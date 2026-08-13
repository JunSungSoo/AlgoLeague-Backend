import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { generationJobs, problems, testCases } from "../../db/schema";
import { canAutoPublish, requiresHumanReview, type ProblemPackage } from "../../domain/generation";
import type { ValidationReport } from "./validator";

export async function claimGenerationJob(id: string) {
    const [job] = await db
        .update(generationJobs)
        .set({
            state: "GENERATING",
            attempts: sql`${generationJobs.attempts}+1`,
            updatedAt: new Date(),
        })
        .where(and(eq(generationJobs.id, id), eq(generationJobs.state, "REQUESTED")))
        .returning();
    return job ?? null;
}

export async function rejectGenerationJob(
    id: string,
    state: "REJECTED_SCHEMA" | "REJECTED_WEAK_TESTS",
    reason: string,
    report?: ValidationReport,
) {
    await db
        .update(generationJobs)
        .set({ state, failureReason: reason, report, updatedAt: new Date() })
        .where(eq(generationJobs.id, id));
}

export async function completeGenerationJob(
    id: string,
    candidate: ProblemPackage,
    report: ValidationReport,
    champions = false,
    provider?: string,
    model?: string,
) {
    if (requiresHumanReview(candidate.grade, champions)) {
        await db
            .update(generationJobs)
            .set({
                state: "REVIEW_REQUIRED",
                package: candidate,
                report,
                failureReason: null,
                updatedAt: new Date(),
            })
            .where(eq(generationJobs.id, id));
        return "REVIEW_REQUIRED" as const;
    }
    if (!canAutoPublish(candidate.grade, champions, report)) {
        await rejectGenerationJob(
            id,
            "REJECTED_WEAK_TESTS",
            "자동 게시 검증 기준을 충족하지 못했습니다.",
            report,
        );
        return "REJECTED_WEAK_TESTS" as const;
    }
    await db.transaction(async (tx) => {
        const now = new Date();
        const slug = `generated-${candidate.grade}-${id}`;
        const [problem] = await tx
            .insert(problems)
            .values({
                slug,
                status: "PUBLISHED",
                title: candidate.title,
                statement: candidate.statement,
                inputDescription: candidate.input,
                outputDescription: candidate.output,
                constraints: candidate.constraints,
                samples: candidate.samples,
                explanation: candidate.explanation,
                grade: candidate.grade,
                primaryTag: candidate.primaryTag,
                secondaryTags: candidate.secondaryTags,
                publishedAt: now,
            })
            .returning({ id: problems.id });
        await tx.insert(testCases).values([
            ...candidate.samples.map((sample, index) => ({
                problemId: problem.id,
                input: sample.input,
                expectedOutput: sample.output,
                groupName: "generated-sample",
                isPublic: true,
                ordinal: index + 1,
            })),
            ...candidate.hiddenTests.map((test, index) => ({
                problemId: problem.id,
                input: test.input,
                expectedOutput: test.output,
                groupName: "generated-hidden",
                isPublic: false,
                ordinal: candidate.samples.length + index + 1,
            })),
        ]);
        await tx
            .update(generationJobs)
            .set({
                state: "PUBLISHED",
                model: provider && model ? `${provider}:${model}` : (model ?? "unknown"),
                package: candidate,
                report,
                failureReason: null,
                updatedAt: now,
            })
            .where(eq(generationJobs.id, id));
    });
    return "PUBLISHED" as const;
}
