import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { assignments, gradeEvents, problems, solvedProblems, users } from "../../db/schema";
import { chooseNextProblem, kstDayKey } from "../../domain/assignment-policy";
import { applyInactivity, type Grade, type GradeState } from "../../domain/grade-policy";
import { dayjs } from "../../lib/dayjs-config";

async function runPolicies(now = dayjs().toDate()) {
    const learners = await db.select().from(users);
    const catalog = await db.select().from(problems).where(eq(problems.status, "PUBLISHED"));
    for (const user of learners)
        await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
            const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
            const state: GradeState = {
                grade: fresh.grade as Grade,
                verifiedSolves: fresh.verifiedSolves,
                checkpoint: fresh.gradeCheckpoint,
                championsEligible: fresh.championsEligible,
                lastFirstAcceptedAt: fresh.lastFirstAcceptedAt,
                lastDemotedAt: fresh.lastDemotedAt,
            };
            const demotion = applyInactivity(state, now, fresh.createdAt);
            if (demotion.events.length) {
                await tx
                    .update(users)
                    .set({
                        grade: demotion.state.grade,
                        gradeCheckpoint: demotion.state.checkpoint,
                        championsEligible: demotion.state.championsEligible,
                        lastDemotedAt: demotion.state.lastDemotedAt,
                        updatedAt: now,
                    })
                    .where(eq(users.id, fresh.id));
                for (const [index, event] of demotion.events.entries())
                    await tx
                        .insert(gradeEvents)
                        .values({
                            userId: fresh.id,
                            eventKey: `policy:${kstDayKey(now)}:${fresh.id}:${event.kind}:${index}`,
                            kind: event.kind,
                            fromGrade: event.fromGrade,
                            toGrade: event.toGrade,
                            checkpoint: demotion.state.checkpoint,
                        })
                        .onConflictDoNothing();
            }
            const active = await tx
                .select()
                .from(assignments)
                .where(and(eq(assignments.userId, fresh.id), isNull(assignments.completedAt)))
                .limit(1);
            if (active.length) return;
            const solved = await tx
                .select({ id: solvedProblems.problemId })
                .from(solvedProblems)
                .where(and(eq(solvedProblems.userId, fresh.id), isNull(solvedProblems.voidedAt)));
            const next = chooseNextProblem(
                demotion.state.grade,
                catalog.map((p) => ({
                    id: p.id,
                    grade: p.grade as Grade,
                    primaryTag: p.primaryTag,
                    secondaryTags: p.secondaryTags,
                    publishedAt: p.publishedAt ?? p.createdAt,
                })),
                new Set(solved.map((item) => item.id)),
            );
            if (next)
                await tx
                    .insert(assignments)
                    .values({
                        userId: fresh.id,
                        problemId: next.id,
                        kstDay: kstDayKey(now),
                        source: "DAILY",
                    })
                    .onConflictDoNothing();
        });
}

await runPolicies();
console.log("policy cycle complete");
