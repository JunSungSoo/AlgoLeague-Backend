import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs, generationJobs, problems, testCases } from "../../db/schema";
import {
    automaticPublicationReportSchema,
    canAutoPublish,
    problemPackageSchema,
    requiresHumanReview,
    type ProblemPackage,
} from "../../domain/generation";
import type { ValidationReport } from "./validator";
import { problemFingerprint, problemTitleKey } from "../../domain/problem-identity";
import { dayjs } from "../../lib/dayjs-config";

export async function findPublishedDuplicate(candidate: ProblemPackage) {
    const fingerprint = problemFingerprint(candidate);
    const titleKey = problemTitleKey(candidate.title);
    const [duplicate] = await db
        .select({ id: problems.id, title: problems.title })
        .from(problems)
        .where(
            and(
                eq(problems.status, "PUBLISHED"),
                or(
                    eq(problems.contentFingerprint, fingerprint),
                    sql`lower(regexp_replace(${problems.title}, '[^[:alnum:]가-힣]', '', 'g')) = ${titleKey}`,
                ),
            ),
        )
        .limit(1);
    return duplicate ?? null;
}

export async function claimGenerationJob(id: string) {
    const [job] = await db
        .update(generationJobs)
        .set({
            state: "GENERATING",
            attempts: sql`${generationJobs.attempts}+1`,
            updatedAt: dayjs().toDate(),
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
        .set({ state, failureReason: reason, report, updatedAt: dayjs().toDate() })
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
                model: provider && model ? `${provider}:${model}` : (model ?? "unknown"),
                failureReason: null,
                updatedAt: dayjs().toDate(),
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
    const publication = await publishGenerationCandidate(id, candidate, report, {
        provider,
        model,
    });
    return publication.state;
}

export async function publishReviewedGenerationJob(id: string, actorId: string) {
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, id)).limit(1);
    if (!job) return { state: "NOT_FOUND" as const };
    if (job.state !== "REVIEW_REQUIRED") return { state: "NOT_REVIEWABLE" as const };
    const candidate = problemPackageSchema.safeParse(job.package);
    const report = automaticPublicationReportSchema.safeParse(job.report);
    if (!candidate.success || !report.success) return { state: "INVALID_PACKAGE" as const };
    return publishGenerationCandidate(id, candidate.data, report.data, {
        actorId,
        expectedState: "REVIEW_REQUIRED",
        model: job.model,
    });
}

export async function rejectReviewedGenerationJob(id: string, actorId: string, reason: string) {
    return db.transaction(async (tx) => {
        const now = dayjs().toDate();
        const [rejected] = await tx
            .update(generationJobs)
            .set({
                state: "REJECTED_REVIEW",
                failureReason: reason,
                updatedAt: now,
            })
            .where(and(eq(generationJobs.id, id), eq(generationJobs.state, "REVIEW_REQUIRED")))
            .returning({ id: generationJobs.id });
        if (!rejected) return false;
        await tx.insert(auditLogs).values({
            actorId,
            action: "GENERATION_REVIEW_REJECTED",
            targetType: "generation_job",
            targetId: id,
            metadata: { reason },
        });
        return true;
    });
}

type PublicationOptions = {
    actorId?: string;
    expectedState?: "REVIEW_REQUIRED";
    provider?: string;
    model?: string;
};
type PublicationResult = {
    state: "PUBLISHED" | "REJECTED_DUPLICATE" | "NOT_REVIEWABLE";
    problemId?: string;
};

async function publishGenerationCandidate(
    id: string,
    candidate: ProblemPackage,
    report: ValidationReport,
    options: PublicationOptions = {},
): Promise<PublicationResult> {
    const fingerprint = problemFingerprint(candidate);
    const titleKey = problemTitleKey(candidate.title);
    let finalState: "PUBLISHED" | "REJECTED_DUPLICATE" | "NOT_REVIEWABLE" = "PUBLISHED";
    let publishedProblemId: string | undefined;
    await db.transaction(async (tx) => {
        const now = dayjs().toDate();
        if (options.expectedState) {
            const [claimed] = await tx
                .update(generationJobs)
                .set({ state: "APPROVED", failureReason: null, updatedAt: now })
                .where(
                    and(eq(generationJobs.id, id), eq(generationJobs.state, options.expectedState)),
                )
                .returning({ id: generationJobs.id });
            if (!claimed) {
                finalState = "NOT_REVIEWABLE";
                return;
            }
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprint}))`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${titleKey}))`);
        const [duplicate] = await tx
            .select({ id: problems.id })
            .from(problems)
            .where(
                and(
                    eq(problems.status, "PUBLISHED"),
                    or(
                        eq(problems.contentFingerprint, fingerprint),
                        sql`lower(regexp_replace(${problems.title}, '[^[:alnum:]가-힣]', '', 'g')) = ${titleKey}`,
                    ),
                ),
            )
            .limit(1);
        if (duplicate) {
            finalState = "REJECTED_DUPLICATE";
            await tx
                .update(generationJobs)
                .set({
                    state: "REJECTED_DUPLICATE",
                    package: candidate,
                    report: { ...report, duplicateScore: 1 },
                    failureReason: `기존 게시 문제와 중복됩니다: ${duplicate.id}`,
                    updatedAt: now,
                })
                .where(eq(generationJobs.id, id));
            if (options.actorId)
                await tx.insert(auditLogs).values({
                    actorId: options.actorId,
                    action: "GENERATION_REVIEW_REJECTED_DUPLICATE",
                    targetType: "generation_job",
                    targetId: id,
                    metadata: { duplicateProblemId: duplicate.id },
                });
            return;
        }
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
                executionMode: "function",
                functionSpec: candidate.functionSpec,
                contentFingerprint: fingerprint,
                publishedAt: now,
            })
            .returning({ id: problems.id, slug: problems.slug });
        publishedProblemId = problem.id;
        await tx.insert(testCases).values([
            ...candidate.samples.map((sample, index) => ({
                problemId: problem.id,
                input: sample.input,
                expectedOutput: sample.output,
                argumentsJson: sample.arguments,
                expectedValue: sample.expected,
                groupName: "generated-sample",
                isPublic: true,
                ordinal: index + 1,
            })),
            ...candidate.hiddenTests.map((test, index) => ({
                problemId: problem.id,
                input: test.input,
                expectedOutput: test.output,
                argumentsJson: test.arguments,
                expectedValue: test.expected,
                groupName: "generated-hidden",
                isPublic: false,
                ordinal: candidate.samples.length + index + 1,
            })),
        ]);
        await tx
            .update(generationJobs)
            .set({
                state: "PUBLISHED",
                model:
                    options.provider && options.model
                        ? `${options.provider}:${options.model}`
                        : (options.model ?? "unknown"),
                package: candidate,
                report,
                failureReason: null,
                updatedAt: now,
            })
            .where(eq(generationJobs.id, id));
        if (options.actorId)
            await tx.insert(auditLogs).values({
                actorId: options.actorId,
                action: "GENERATION_REVIEW_APPROVED",
                targetType: "generation_job",
                targetId: id,
                metadata: { problemId: problem.id, slug: problem.slug },
            });
    });
    return { state: finalState, problemId: publishedProblemId };
}
