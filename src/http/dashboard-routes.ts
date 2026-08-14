import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, gt, gte, isNull, notInArray, sql } from "drizzle-orm";
import { gradeProgress, type Grade, type GradeState } from "../domain/grade-policy";
import { dayjs } from "../lib/dayjs-config";
import { requireScope } from "./auth";

function kstDay(date = dayjs().toDate()) {
    return dayjs(date).tz().format("YYYY-MM-DD");
}
function startOfKstDay(day: string) {
    return dayjs.tz(day).startOf("day").toDate();
}
function startOfKstWeek(now = dayjs().toDate()) {
    return dayjs(now).tz().startOf("isoWeek").toDate();
}
function streakFromDates(dates: Date[], today = kstDay()) {
    const days = new Set(dates.map((date) => kstDay(date)));
    let cursor = startOfKstDay(today);
    if (!days.has(kstDay(cursor))) cursor = dayjs(cursor).subtract(1, "day").toDate();
    let streak = 0;
    while (days.has(kstDay(cursor))) {
        streak += 1;
        cursor = dayjs(cursor).subtract(1, "day").toDate();
    }
    return streak;
}

export async function registerDashboardRoutes(app: FastifyInstance) {
    app.get("/api/dashboard", async (request, reply) => {
        const session = await requireScope(request, "problem:read");
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        if (!process.env.DATABASE_URL)
            return reply
                .code(503)
                .send({ error: "대시보드 실제 데이터 조회에는 DATABASE_URL이 필요합니다." });
        const { db } = await import("../db/index");
        const { assignments, gradeEvents, problems, solvedProblems, submissions, users } =
            await import("../db/schema");
        const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        const today = kstDay();
        let [assignment] = await db
            .select({
                id: assignments.id,
                createdAt: assignments.createdAt,
                problem: {
                    slug: problems.slug,
                    title: problems.title,
                    grade: problems.grade,
                    primaryTag: problems.primaryTag,
                    secondaryTags: problems.secondaryTags,
                },
            })
            .from(assignments)
            .innerJoin(problems, eq(assignments.problemId, problems.id))
            .where(and(eq(assignments.userId, user.id), eq(assignments.kstDay, today)))
            .orderBy(desc(assignments.createdAt))
            .limit(1);
        if (!assignment)
            [assignment] = await db
                .select({
                    id: assignments.id,
                    createdAt: assignments.createdAt,
                    problem: {
                        slug: problems.slug,
                        title: problems.title,
                        grade: problems.grade,
                        primaryTag: problems.primaryTag,
                        secondaryTags: problems.secondaryTags,
                    },
                })
                .from(assignments)
                .innerJoin(problems, eq(assignments.problemId, problems.id))
                .where(and(eq(assignments.userId, user.id), isNull(assignments.completedAt)))
                .orderBy(desc(assignments.createdAt))
                .limit(1);
        if (!assignment) {
            const assigned = await db
                .select({ id: assignments.problemId })
                .from(assignments)
                .where(eq(assignments.userId, user.id));
            const assignedIds = assigned.map((item) => item.id);
            const minimumGrade = Math.max(1, user.grade - 1);
            const [candidate] = await db
                .select()
                .from(problems)
                .leftJoin(
                    solvedProblems,
                    and(
                        eq(solvedProblems.problemId, problems.id),
                        eq(solvedProblems.userId, user.id),
                        isNull(solvedProblems.voidedAt),
                    ),
                )
                .where(
                    and(
                        eq(problems.status, "PUBLISHED"),
                        gte(problems.grade, minimumGrade),
                        isNull(solvedProblems.problemId),
                        assignedIds.length ? notInArray(problems.id, assignedIds) : undefined,
                    ),
                )
                .orderBy(asc(sql`abs(${problems.grade}-${user.grade})`), desc(problems.publishedAt))
                .limit(1);
            if (candidate?.problems) {
                const [created] = await db
                    .insert(assignments)
                    .values({
                        userId: user.id,
                        problemId: candidate.problems.id,
                        kstDay: today,
                        source: "daily-auto",
                    })
                    .onConflictDoNothing()
                    .returning();
                if (created)
                    assignment = {
                        id: created.id,
                        createdAt: created.createdAt,
                        problem: {
                            slug: candidate.problems.slug,
                            title: candidate.problems.title,
                            grade: candidate.problems.grade,
                            primaryTag: candidate.problems.primaryTag,
                            secondaryTags: candidate.problems.secondaryTags,
                        },
                    };
            }
        }
        const weekStart = startOfKstWeek();
        const [
            weeklyRow,
            rankRow,
            populationRow,
            acceptedDates,
            recentSubmissions,
            recentGradeEvents,
            recentAssignments,
        ] = await Promise.all([
            db
                .select({ value: count() })
                .from(solvedProblems)
                .where(
                    and(
                        eq(solvedProblems.userId, user.id),
                        isNull(solvedProblems.voidedAt),
                        gte(solvedProblems.acceptedAt, weekStart),
                    ),
                ),
            db
                .select({ value: count() })
                .from(users)
                .where(
                    and(eq(users.grade, user.grade), gt(users.verifiedSolves, user.verifiedSolves)),
                ),
            db.select({ value: count() }).from(users).where(eq(users.grade, user.grade)),
            db
                .select({ acceptedAt: solvedProblems.acceptedAt })
                .from(solvedProblems)
                .where(and(eq(solvedProblems.userId, user.id), isNull(solvedProblems.voidedAt)))
                .orderBy(desc(solvedProblems.acceptedAt)),
            db
                .select({
                    id: submissions.id,
                    verdict: submissions.verdict,
                    language: submissions.language,
                    runtimeMs: submissions.runtimeMs,
                    firstAccepted: submissions.firstAccepted,
                    createdAt: submissions.createdAt,
                    judgedAt: submissions.judgedAt,
                    title: problems.title,
                })
                .from(submissions)
                .innerJoin(problems, eq(submissions.problemId, problems.id))
                .where(
                    and(eq(submissions.userId, user.id), sql`${submissions.judgedAt} is not null`),
                )
                .orderBy(desc(submissions.judgedAt))
                .limit(8),
            db
                .select()
                .from(gradeEvents)
                .where(eq(gradeEvents.userId, user.id))
                .orderBy(desc(gradeEvents.createdAt))
                .limit(8),
            db
                .select({
                    id: assignments.id,
                    createdAt: assignments.createdAt,
                    title: problems.title,
                    grade: problems.grade,
                    source: assignments.source,
                })
                .from(assignments)
                .innerJoin(problems, eq(assignments.problemId, problems.id))
                .where(eq(assignments.userId, user.id))
                .orderBy(desc(assignments.createdAt))
                .limit(8),
        ]);
        const state: GradeState = {
            grade: user.grade as Grade,
            verifiedSolves: user.verifiedSolves,
            checkpoint: user.gradeCheckpoint,
            championsEligible: user.championsEligible,
            lastFirstAcceptedAt: user.lastFirstAcceptedAt,
            lastDemotedAt: user.lastDemotedAt,
        };
        const progress = gradeProgress(state);
        const activities = [
            ...recentSubmissions.map((item) => ({
                id: `submission:${item.id}`,
                type: "submission" as const,
                title: `${item.title} ${item.verdict === "AC" ? "정답" : item.verdict}`,
                detail: `${item.language}${item.runtimeMs != null ? ` · ${item.runtimeMs}ms` : ""}${item.firstAccepted ? " · 최초 정답" : ""}`,
                occurredAt: dayjs(item.judgedAt ?? item.createdAt).toISOString(),
            })),
            ...recentGradeEvents.map((item) => ({
                id: `grade:${item.id}`,
                type: "grade" as const,
                title:
                    item.kind === "PROMOTED"
                        ? `${item.toGrade}급으로 승급했어요`
                        : item.kind === "DEMOTED"
                          ? `${item.toGrade}급으로 조정되었어요`
                          : item.kind === "CHAMPIONS_ELIGIBLE"
                            ? "리그 참가권을 획득했어요"
                            : "리그 참가권이 조정되었어요",
                detail: `${item.fromGrade}급 → ${item.toGrade}급 · 누적 정답 ${item.checkpoint}개`,
                occurredAt: dayjs(item.createdAt).toISOString(),
            })),
            ...recentAssignments.map((item) => ({
                id: `assignment:${item.id}`,
                type: "assignment" as const,
                title: "오늘의 문제가 배정되었어요",
                detail: `${item.title} · ${item.grade}급`,
                occurredAt: dayjs(item.createdAt).toISOString(),
            })),
        ]
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .slice(0, 8);
        return {
            generatedAt: dayjs().toISOString(),
            kstDay: today,
            user: {
                nickname: user.nickname,
                grade: user.grade,
                verifiedSolves: user.verifiedSolves,
                championsEligible: user.championsEligible,
            },
            todayProblem: assignment?.problem ?? null,
            progress: { ...progress, next: user.grade > 1 ? user.grade - 1 : null },
            stats: {
                streakDays: streakFromDates(acceptedDates.map((item) => item.acceptedAt)),
                weeklyAccepted: weeklyRow[0]?.value ?? 0,
                gradeRank: Number(rankRow[0]?.value ?? 0) + 1,
                gradePopulation: Number(populationRow[0]?.value ?? 0),
            },
            activities,
            dataAvailability: {
                hasPublishedProblem: Boolean(assignment),
                hasSolvedHistory: acceptedDates.length > 0,
                hasActivity: activities.length > 0,
            },
        };
    });
}
