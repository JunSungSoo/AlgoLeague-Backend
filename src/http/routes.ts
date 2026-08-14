import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import {
    and,
    asc,
    count,
    countDistinct,
    desc,
    eq,
    gte,
    inArray,
    isNull,
    ne,
    notInArray,
    sql,
} from "drizzle-orm";
import { z } from "zod";
import {
    buildFunctionHarness,
    expectedFunctionOutput,
    type FunctionSpec,
} from "../domain/function-spec";
import { compareOutput, type JudgeLanguage } from "../domain/judge";
import { runSandbox } from "../workers/judge/sandbox";
import { problemTitleKey } from "../domain/problem-identity";
import { defaultRuntimeVersion, isRuntimeVersion } from "../domain/runtime-versions";
import {
    canAccessProblem,
    gradeProgress,
    submissionLimit,
    type Grade,
    type GradeState,
} from "../domain/grade-policy";
import { requireScope } from "./auth";
import { registerAuthRoutes } from "./auth-routes";
import { registerDashboardRoutes } from "./dashboard-routes";
import { dayjs } from "../lib/dayjs-config";

const codeSchema = z
    .object({
        language: z.enum(["python", "java", "javascript", "cpp"]),
        runtimeVersion: z.string().min(1).max(40).optional(),
        code: z.string().min(1).max(100_000),
    })
    .superRefine((value, context) => {
        if (value.runtimeVersion && !isRuntimeVersion(value.language, value.runtimeVersion))
            context.addIssue({
                code: "custom",
                path: ["runtimeVersion"],
                message: "지원하지 않는 실행 버전입니다.",
            });
    });
const completionQuerySchema = z.object({
    sort: z.enum(["recommended", "latest", "comments"]).default("recommended"),
    page: z.coerce.number().int().min(1).default(1),
});

export async function registerRoutes(app: FastifyInstance) {
    await registerAuthRoutes(app);
    await registerDashboardRoutes(app);
    app.get("/api/health", async () => ({
        status: "ok",
        service: "algorithm-champions-back",
        time: dayjs().toISOString(),
    }));
    app.get("/api/problems", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(403).send({ error: "읽기 권한이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "문제 목록 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, solvedProblems, submissions, users } = await import("../db/schema");
        const [user] = await db
            .select({ grade: users.grade })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        const [catalog, solved, submissionStats] = await Promise.all([
            db
                .select({
                    id: problems.id,
                    slug: problems.slug,
                    title: problems.title,
                    grade: problems.grade,
                    primaryTag: problems.primaryTag,
                    secondaryTags: problems.secondaryTags,
                    timeLimitMs: problems.timeLimitMs,
                    publishedAt: problems.publishedAt,
                })
                .from(problems)
                .where(eq(problems.status, "PUBLISHED"))
                .orderBy(desc(problems.publishedAt), desc(problems.createdAt)),
            db
                .select({
                    problemId: solvedProblems.problemId,
                    submissionId: solvedProblems.submissionId,
                })
                .from(solvedProblems)
                .where(
                    and(eq(solvedProblems.userId, session.userId), isNull(solvedProblems.voidedAt)),
                ),
            db
                .select({
                    problemId: submissions.problemId,
                    total: sql<number>`count(*) filter (where ${submissions.verdict} not in ('QU','RN','JH','IE'))`,
                    accepted: sql<number>`count(*) filter (where ${submissions.verdict} = 'AC')`,
                })
                .from(submissions)
                .where(eq(submissions.userId, session.userId))
                .groupBy(submissions.problemId),
        ]);
        const solvedIds = new Set(solved.map((item) => item.problemId));
        const stats = new Map(
            submissionStats.map((item) => [
                item.problemId,
                { total: Number(item.total), accepted: Number(item.accepted) },
            ]),
        );
        const seenTitles = new Set<string>();
        const uniqueCatalog = catalog.filter((problem) => {
            const key = problemTitleKey(problem.title);
            if (seenTitles.has(key)) return false;
            seenTitles.add(key);
            return true;
        });
        return {
            userGrade: user.grade,
            accessibleRange: { from: 9, to: Math.max(1, user.grade - 1) },
            items: uniqueCatalog.map(({ id, ...problem }) => {
                const stat = stats.get(id);
                return {
                    ...problem,
                    solved: solvedIds.has(id),
                    accessible: canAccessProblem(user.grade as Grade, problem.grade as Grade),
                    acceptanceRate: stat?.total
                        ? Math.round((stat.accepted / stat.total) * 100)
                        : null,
                };
            }),
        };
    });
    app.get("/api/my-problems", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "나의 문제 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, solvedProblems, submissions, users } = await import("../db/schema");
        const [user] = await db
            .select({ grade: users.grade })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        const [attempted, solved, submissionStats] = await Promise.all([
            db
                .select({
                    id: problems.id,
                    slug: problems.slug,
                    title: problems.title,
                    grade: problems.grade,
                    primaryTag: problems.primaryTag,
                    secondaryTags: problems.secondaryTags,
                    timeLimitMs: problems.timeLimitMs,
                    publishedAt: problems.publishedAt,
                    lastSubmittedAt: sql<Date>`max(${submissions.createdAt})`,
                    submissionCount: count(submissions.id),
                })
                .from(submissions)
                .innerJoin(problems, eq(submissions.problemId, problems.id))
                .where(
                    and(eq(submissions.userId, session.userId), eq(problems.status, "PUBLISHED")),
                )
                .groupBy(problems.id)
                .orderBy(desc(sql`max(${submissions.createdAt})`)),
            db
                .select({
                    problemId: solvedProblems.problemId,
                    submissionId: solvedProblems.submissionId,
                })
                .from(solvedProblems)
                .where(
                    and(eq(solvedProblems.userId, session.userId), isNull(solvedProblems.voidedAt)),
                ),
            db
                .select({
                    problemId: submissions.problemId,
                    total: sql<number>`count(*) filter (where ${submissions.verdict} not in ('QU','RN','JH','IE'))`,
                    accepted: sql<number>`count(*) filter (where ${submissions.verdict} = 'AC')`,
                })
                .from(submissions)
                .where(eq(submissions.userId, session.userId))
                .groupBy(submissions.problemId),
        ]);
        const solvedIds = new Set(solved.map((item) => item.problemId));
        const stats = new Map(
            submissionStats.map((item) => [
                item.problemId,
                { total: Number(item.total), accepted: Number(item.accepted) },
            ]),
        );
        return {
            userGrade: user.grade,
            accessibleRange: { from: 9, to: 1 },
            items: attempted.map(({ id, lastSubmittedAt, submissionCount, ...problem }) => {
                const stat = stats.get(id);
                return {
                    ...problem,
                    solved: solvedIds.has(id),
                    accessible: true,
                    acceptanceRate: stat?.total
                        ? Math.round((stat.accepted / stat.total) * 100)
                        : null,
                    lastSubmittedAt: dayjs(lastSubmittedAt).toISOString(),
                    submissionCount: Number(submissionCount),
                };
            }),
        };
    });
    app.get<{ Params: { id: string } }>("/api/problems/:id", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "문제 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, solvedProblems, submissions, users } = await import("../db/schema");
        const [[user], [problem]] = await Promise.all([
            db
                .select({ grade: users.grade })
                .from(users)
                .where(eq(users.id, session.userId))
                .limit(1),
            db
                .select()
                .from(problems)
                .where(and(eq(problems.slug, request.params.id), eq(problems.status, "PUBLISHED")))
                .orderBy(desc(problems.version))
                .limit(1),
        ]);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        if (!problem) return reply.code(404).send({ error: "게시 중인 문제를 찾을 수 없습니다." });
        const [[solved], [attemptRow]] = await Promise.all([
            db
                .select({
                    problemId: solvedProblems.problemId,
                    submissionId: solvedProblems.submissionId,
                })
                .from(solvedProblems)
                .where(
                    and(
                        eq(solvedProblems.userId, session.userId),
                        eq(solvedProblems.problemId, problem.id),
                        isNull(solvedProblems.voidedAt),
                    ),
                )
                .limit(1),
            db
                .select({ value: count() })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.userId, session.userId),
                        eq(submissions.problemId, problem.id),
                        notInArray(submissions.verdict, ["JH", "IE"]),
                    ),
                ),
        ]);
        const attempts = Number(attemptRow?.value ?? 0);
        if (!canAccessProblem(user.grade as Grade, problem.grade as Grade) && attempts === 0)
            return reply
                .code(403)
                .send({ error: `현재 ${user.grade}급에서는 이 문제에 접근할 수 없습니다.` });
        const limit = submissionLimit(problem.grade as Grade);
        return {
            problem: {
                slug: problem.slug,
                title: problem.title,
                statement: problem.statement,
                inputDescription: problem.inputDescription,
                outputDescription: problem.outputDescription,
                constraints: problem.constraints,
                samples: problem.samples,
                executionMode: problem.executionMode,
                functionSpec: problem.functionSpec,
                sampleTests:
                    problem.executionMode === "function" ? problem.samples.slice(0, 3) : [],
                grade: problem.grade,
                primaryTag: problem.primaryTag,
                secondaryTags: problem.secondaryTags,
                timeLimitMs: problem.timeLimitMs,
                solved: Boolean(solved),
                acceptedSubmissionId: solved?.submissionId ?? null,
                attempts,
                submissionLimit: limit,
            },
        };
    });
    app.get<{ Params: { id: string } }>("/api/submissions/:id/status", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "채점 결과 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, submissions } = await import("../db/schema");
        const [submission] = await db
            .select({
                id: submissions.id,
                verdict: submissions.verdict,
                problemSlug: problems.slug,
                judgedAt: submissions.judgedAt,
                errorMessage: submissions.errorMessage,
            })
            .from(submissions)
            .innerJoin(problems, eq(submissions.problemId, problems.id))
            .where(
                and(eq(submissions.id, request.params.id), eq(submissions.userId, session.userId)),
            )
            .limit(1);
        if (!submission) return reply.code(404).send({ error: "제출 기록을 찾을 수 없습니다." });
        return {
            submission: {
                ...submission,
                judgedAt: submission.judgedAt ? dayjs(submission.judgedAt).toISOString() : null,
            },
        };
    });
    app.get<{
        Params: { id: string };
        Querystring: { sort?: string; page?: string };
    }>("/api/submissions/:id/completion", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const parsed = completionQuerySchema.safeParse(request.query);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "완료 답안 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, submissionComments, submissionRecommendations, submissions, users } =
            await import("../db/schema");
        const [own] = await db
            .select({
                id: submissions.id,
                problemId: submissions.problemId,
                problemSlug: problems.slug,
                problemTitle: problems.title,
                problemGrade: problems.grade,
                language: submissions.language,
                runtimeVersion: submissions.runtimeVersion,
                sourceCode: submissions.sourceCode,
                verdict: submissions.verdict,
                runtimeMs: submissions.runtimeMs,
                memoryKb: submissions.memoryKb,
                createdAt: submissions.createdAt,
                judgedAt: submissions.judgedAt,
                nickname: users.nickname,
                profileImageUrl: users.profileImageUrl,
                recommendationCount: countDistinct(submissionRecommendations.userId),
                commentCount: countDistinct(submissionComments.id),
            })
            .from(submissions)
            .innerJoin(problems, eq(submissions.problemId, problems.id))
            .innerJoin(users, eq(submissions.userId, users.id))
            .leftJoin(
                submissionRecommendations,
                eq(submissionRecommendations.submissionId, submissions.id),
            )
            .leftJoin(submissionComments, eq(submissionComments.submissionId, submissions.id))
            .where(
                and(eq(submissions.id, request.params.id), eq(submissions.userId, session.userId)),
            )
            .groupBy(submissions.id, problems.id, users.id)
            .limit(1);
        if (!own) return reply.code(404).send({ error: "제출 기록을 찾을 수 없습니다." });
        if (own.verdict !== "AC")
            return reply
                .code(409)
                .send({ error: "정답으로 확정된 제출만 완료 화면에서 볼 수 있습니다." });

        const pageSize = 6;
        const offset = (parsed.data.page - 1) * pageSize;
        const recommendationCount = countDistinct(submissionRecommendations.userId);
        const commentCount = countDistinct(submissionComments.id);
        const primaryOrder =
            parsed.data.sort === "latest"
                ? desc(submissions.createdAt)
                : parsed.data.sort === "comments"
                  ? desc(commentCount)
                  : desc(recommendationCount);
        const [[totalRow], answers] = await Promise.all([
            db
                .select({ value: count() })
                .from(submissions)
                .where(
                    and(
                        eq(submissions.problemId, own.problemId),
                        eq(submissions.verdict, "AC"),
                        eq(submissions.firstAccepted, true),
                        ne(submissions.userId, session.userId),
                    ),
                ),
            db
                .select({
                    id: submissions.id,
                    nickname: users.nickname,
                    profileImageUrl: users.profileImageUrl,
                    language: submissions.language,
                    runtimeVersion: submissions.runtimeVersion,
                    sourceCode: submissions.sourceCode,
                    runtimeMs: submissions.runtimeMs,
                    createdAt: submissions.createdAt,
                    recommendationCount,
                    commentCount,
                })
                .from(submissions)
                .innerJoin(users, eq(submissions.userId, users.id))
                .leftJoin(
                    submissionRecommendations,
                    eq(submissionRecommendations.submissionId, submissions.id),
                )
                .leftJoin(submissionComments, eq(submissionComments.submissionId, submissions.id))
                .where(
                    and(
                        eq(submissions.problemId, own.problemId),
                        eq(submissions.verdict, "AC"),
                        eq(submissions.firstAccepted, true),
                        ne(submissions.userId, session.userId),
                    ),
                )
                .groupBy(submissions.id, users.id)
                .orderBy(primaryOrder, desc(submissions.createdAt), desc(submissions.id))
                .limit(pageSize)
                .offset(offset),
        ]);
        const total = Number(totalRow?.value ?? 0);
        return {
            problem: {
                slug: own.problemSlug,
                title: own.problemTitle,
                grade: own.problemGrade,
            },
            submission: {
                id: own.id,
                nickname: own.nickname,
                profileImageUrl: own.profileImageUrl,
                language: own.language,
                runtimeVersion:
                    own.runtimeVersion ?? defaultRuntimeVersion(own.language as JudgeLanguage),
                sourceCode: own.sourceCode,
                verdict: own.verdict,
                runtimeMs: own.runtimeMs,
                memoryKb: own.memoryKb,
                recommendationCount: Number(own.recommendationCount),
                commentCount: Number(own.commentCount),
                createdAt: dayjs(own.createdAt).toISOString(),
                judgedAt: own.judgedAt ? dayjs(own.judgedAt).toISOString() : null,
            },
            answers: {
                sort: parsed.data.sort,
                page: parsed.data.page,
                pageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
                items: answers.map((answer) => ({
                    ...answer,
                    recommendationCount: Number(answer.recommendationCount),
                    commentCount: Number(answer.commentCount),
                    createdAt: dayjs(answer.createdAt).toISOString(),
                })),
            },
        };
    });
    app.get<{ Params: { grade: string } }>("/api/rankings/:grade", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const grade = Number(request.params.grade);
        if (!Number.isInteger(grade) || grade < 1 || grade > 9)
            return reply.code(400).send({ error: "등급은 1–9 사이여야 합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "랭킹 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { submissions, users } = await import("../db/schema");
        const learners = await db
            .select({
                id: users.id,
                nickname: users.nickname,
                verifiedSolves: users.verifiedSolves,
            })
            .from(users)
            .where(eq(users.grade, grade))
            .orderBy(desc(users.verifiedSolves), users.nickname);
        const ids = learners.map((item) => item.id);
        const judged = ids.length
            ? await db
                  .select({
                      userId: submissions.userId,
                      verdict: submissions.verdict,
                      judgedAt: submissions.judgedAt,
                  })
                  .from(submissions)
                  .where(
                      and(
                          inArray(submissions.userId, ids),
                          sql`${submissions.judgedAt} is not null`,
                      ),
                  )
            : [];
        const byUser = new Map<string, { total: number; accepted: number; recent: Date | null }>();
        for (const item of judged) {
            const stat = byUser.get(item.userId) ?? { total: 0, accepted: 0, recent: null };
            if (!["JH", "IE"].includes(item.verdict)) {
                stat.total += 1;
                if (item.verdict === "AC") stat.accepted += 1;
            }
            if (item.judgedAt && (!stat.recent || item.judgedAt > stat.recent))
                stat.recent = item.judgedAt;
            byUser.set(item.userId, stat);
        }
        return {
            grade,
            generatedAt: dayjs().toISOString(),
            currentUserId: session.userId,
            items: learners.map((user, index) => {
                const stat = byUser.get(user.id);
                return {
                    rank: index + 1,
                    userId: user.id,
                    nickname: user.nickname,
                    verifiedSolves: user.verifiedSolves,
                    acceptanceRate: stat?.total
                        ? Math.round((stat.accepted / stat.total) * 100)
                        : null,
                    lastActivityAt: stat?.recent ? dayjs(stat.recent).toISOString() : null,
                };
            }),
        };
    });
    app.get("/api/grade-progress", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "등급 현황 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { gradeEvents, solvedProblems, users } = await import("../db/schema");
        const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        const [recentEvents, accepted] = await Promise.all([
            db
                .select({
                    id: gradeEvents.id,
                    kind: gradeEvents.kind,
                    fromGrade: gradeEvents.fromGrade,
                    toGrade: gradeEvents.toGrade,
                    checkpoint: gradeEvents.checkpoint,
                    createdAt: gradeEvents.createdAt,
                })
                .from(gradeEvents)
                .where(eq(gradeEvents.userId, user.id))
                .orderBy(desc(gradeEvents.createdAt))
                .limit(10),
            db
                .select({ acceptedAt: solvedProblems.acceptedAt })
                .from(solvedProblems)
                .where(and(eq(solvedProblems.userId, user.id), isNull(solvedProblems.voidedAt)))
                .orderBy(desc(solvedProblems.acceptedAt))
                .limit(30),
        ]);
        const state: GradeState = {
            grade: user.grade as Grade,
            verifiedSolves: user.verifiedSolves,
            checkpoint: user.gradeCheckpoint,
            championsEligible: user.championsEligible,
            lastFirstAcceptedAt: user.lastFirstAcceptedAt,
            lastDemotedAt: user.lastDemotedAt,
        };
        return {
            grade: user.grade,
            verifiedSolves: user.verifiedSolves,
            progress: { ...gradeProgress(state), next: user.grade > 1 ? user.grade - 1 : null },
            championsEligible: user.championsEligible,
            acceptedDates: accepted.map((item) => dayjs(item.acceptedAt).toISOString()),
            events: recentEvents.map((item) => ({
                ...item,
                createdAt: dayjs(item.createdAt).toISOString(),
            })),
        };
    });
    app.get("/api/admin/overview", async (request, reply) => {
        const session = await requireScope(request, "admin:write");
        if (!session) return reply.code(403).send({ error: "관리자 권한이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "운영 현황 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { generationJobs, problems } = await import("../db/schema");
        const since = dayjs().subtract(24, "hour").toDate();
        const [jobs, publishedRows, pendingRows, reviewRows, recentRows, failureRows] =
            await Promise.all([
                db.select().from(generationJobs).orderBy(desc(generationJobs.updatedAt)).limit(30),
                db
                    .select({ value: count() })
                    .from(problems)
                    .where(eq(problems.status, "PUBLISHED")),
                db
                    .select({ value: count() })
                    .from(generationJobs)
                    .where(
                        inArray(generationJobs.state, [
                            "REQUESTED",
                            "GENERATING",
                            "GENERATED",
                            "SCHEMA_VALIDATED",
                            "COMPILED",
                            "FUZZ_VALIDATED",
                            "MUTATION_VALIDATED",
                        ]),
                    ),
                db
                    .select({ value: count() })
                    .from(generationJobs)
                    .where(eq(generationJobs.state, "REVIEW_REQUIRED")),
                db
                    .select({ value: count() })
                    .from(generationJobs)
                    .where(gte(generationJobs.updatedAt, since)),
                db
                    .select({ value: count() })
                    .from(generationJobs)
                    .where(
                        and(
                            gte(generationJobs.updatedAt, since),
                            sql`${generationJobs.state}::text like 'REJECTED_%'`,
                        ),
                    ),
            ]);
        const recent = Number(recentRows[0]?.value ?? 0),
            failures = Number(failureRows[0]?.value ?? 0);
        return {
            generatedAt: dayjs().toISOString(),
            metrics: {
                published: Number(publishedRows[0]?.value ?? 0),
                inProgress: Number(pendingRows[0]?.value ?? 0),
                reviewRequired: Number(reviewRows[0]?.value ?? 0),
                failureRate24h: recent ? Math.round((failures / recent) * 1000) / 10 : 0,
            },
            jobs: jobs.map((job) => {
                const pkg = job.package as { title?: string } | null;
                const report = job.report as { mutationScore?: number } | null;
                return {
                    id: job.id,
                    title: pkg?.title ?? "제목 생성 대기",
                    grade: job.grade,
                    state: job.state,
                    blueprint: job.blueprintVersion,
                    model: job.model,
                    score:
                        typeof report?.mutationScore === "number"
                            ? Math.round(report.mutationScore * 100)
                            : null,
                    attempts: job.attempts,
                    failureReason: job.failureReason,
                    updatedAt: dayjs(job.updatedAt).toISOString(),
                };
            }),
        };
    });
    app.post<{ Params: { id: string } }>("/api/problems/:id/run", async (request, reply) => {
        const session = await requireScope(request, "submission:write");
        if (!session) return reply.code(403).send({ error: "PC 웹 쓰기 권한이 필요합니다." });
        const parsed = codeSchema.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        if (!process.env.DATABASE_URL)
            return reply.code(503).send({ error: "예제 실행에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { problems, testCases } = await import("../db/schema");
        const [problem] = await db
            .select()
            .from(problems)
            .where(and(eq(problems.slug, request.params.id), eq(problems.status, "PUBLISHED")))
            .orderBy(desc(problems.version))
            .limit(1);
        if (!problem) return reply.code(404).send({ error: "게시 중인 문제를 찾을 수 없습니다." });
        const samples = await db
            .select()
            .from(testCases)
            .where(and(eq(testCases.problemId, problem.id), eq(testCases.isPublic, true)))
            .orderBy(asc(testCases.ordinal))
            .limit(3);
        if (!samples.length)
            return reply.code(409).send({ error: "공개 Sample Test가 등록되지 않았습니다." });
        const results = [];
        for (const [index, sample] of samples.entries()) {
            let source = parsed.data.code;
            let input = sample.input;
            let expected = sample.expectedOutput;
            if (problem.executionMode === "function") {
                if (!problem.functionSpec || !sample.argumentsJson || sample.expectedValue === null)
                    return reply.code(500).send({ error: "함수 테스트 명세가 누락되었습니다." });
                source = buildFunctionHarness(
                    parsed.data.language as JudgeLanguage,
                    source,
                    problem.functionSpec as FunctionSpec,
                    sample.argumentsJson,
                );
                input = "";
                expected = expectedFunctionOutput(sample.expectedValue);
            }
            const result = await runSandbox(
                parsed.data.language,
                source,
                input,
                problem.timeLimitMs,
                parsed.data.runtimeVersion ?? defaultRuntimeVersion(parsed.data.language),
            );
            const passed = result.verdict === "AC" && compareOutput(result.stdout, expected);
            results.push({
                ordinal: index + 1,
                passed,
                verdict: passed ? "AC" : result.verdict === "AC" ? "WA" : result.verdict,
                durationMs: Math.round(result.durationMs),
                errorMessage: result.stderr || null,
            });
            if (!passed) break;
        }
        const passed =
            results.length === samples.length && results.every((result) => result.passed);
        return {
            status: passed ? "AC" : results.at(-1)?.verdict,
            verdict: passed ? "AC" : results.at(-1)?.verdict,
            message: passed
                ? `공개 Sample Tests ${samples.length}개를 모두 통과했습니다.`
                : `Sample Test ${results.at(-1)?.ordinal}에서 실패했습니다.`,
            sampleTests: results,
            runtimeVersion:
                parsed.data.runtimeVersion ?? defaultRuntimeVersion(parsed.data.language),
        };
    });
    app.post<{ Params: { id: string } }>("/api/problems/:id/submit", async (request, reply) => {
        const session = await requireScope(request, "submission:write");
        if (!session)
            return reply.code(403).send({ error: "조회 전용 앱에서는 제출할 수 없습니다." });
        const parsed = codeSchema.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
            return reply.code(202).send({
                id: randomUUID(),
                status: "QU",
                verdict: "QU",
                message: "제출이 채점 큐에 등록되었습니다. (개발 미리보기)",
            });
        const { db } = await import("../db/index");
        const { problems, submissions } = await import("../db/schema");
        const [problem] = await db
            .select()
            .from(problems)
            .where(and(eq(problems.slug, request.params.id), eq(problems.status, "PUBLISHED")))
            .limit(1);
        if (!problem) return reply.code(404).send({ error: "게시 중인 문제를 찾을 수 없습니다." });
        const [{ value: attempts }] = await db
            .select({ value: count() })
            .from(submissions)
            .where(
                and(
                    eq(submissions.userId, session.userId),
                    eq(submissions.problemId, problem.id),
                    notInArray(submissions.verdict, ["JH", "IE"]),
                ),
            );
        const limit = submissionLimit(problem.grade as Grade);
        if (attempts >= limit)
            return reply
                .code(409)
                .send({ error: `등급 효력 제출 ${limit}회를 모두 사용했습니다.` });
        const id = randomUUID(),
            traceId = randomUUID();
        await db.insert(submissions).values({
            id,
            userId: session.userId,
            problemId: problem.id,
            language: parsed.data.language,
            runtimeVersion:
                parsed.data.runtimeVersion ?? defaultRuntimeVersion(parsed.data.language),
            sourceCode: parsed.data.code,
            attemptNumber: attempts + 1,
            traceId,
        });
        const redis = new Redis(process.env.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
        await redis.connect();
        await redis.lpush("judge:queued", JSON.stringify({ id }));
        await redis.quit();
        return reply.code(202).send({
            id,
            traceId,
            status: "QU",
            verdict: "QU",
            message: `제출이 채점 큐에 등록되었습니다. 남은 횟수 ${limit - attempts - 1}회`,
        });
    });
}
