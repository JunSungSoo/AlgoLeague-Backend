import type { PoolClient } from "pg";
import { pool } from "../db/index";
import { applyFirstAccepted, type GradeState } from "../domain/grade-policy";
import { dayjs } from "../lib/dayjs-config";

export async function recordAcceptedSubmission(submissionId: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const submission = await client.query<{
            user_id: string;
            problem_id: string;
            verdict: string;
            counts_for_grade: boolean;
        }>(
            "SELECT user_id, problem_id, verdict, counts_for_grade FROM submissions WHERE id=$1 FOR UPDATE",
            [submissionId],
        );
        const row = submission.rows[0];
        if (!row || row.verdict !== "AC" || !row.counts_for_grade) {
            await client.query("ROLLBACK");
            return false;
        }
        const solved = await client.query(
            "INSERT INTO solved_problems(user_id,problem_id,submission_id,accepted_at) VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING RETURNING user_id",
            [row.user_id, row.problem_id, submissionId],
        );
        if (!solved.rowCount) {
            await client.query("COMMIT");
            return false;
        }
        await client.query(
            "UPDATE assignments SET completed_at=now() WHERE user_id=$1 AND problem_id=$2 AND completed_at IS NULL",
            [row.user_id, row.problem_id],
        );
        const user = await loadUserForUpdate(client, row.user_id);
        const result = applyFirstAccepted(user, dayjs().toDate());
        await client.query("UPDATE submissions SET first_accepted=true WHERE id=$1", [
            submissionId,
        ]);
        await client.query(
            "UPDATE users SET grade=$2,verified_solves=$3,grade_checkpoint=$4,champions_eligible=$5,last_first_accepted_at=$6,updated_at=now() WHERE id=$1",
            [
                row.user_id,
                result.state.grade,
                result.state.verifiedSolves,
                result.state.checkpoint,
                result.state.championsEligible,
                result.state.lastFirstAcceptedAt,
            ],
        );
        for (const [index, event] of result.events.entries())
            await client.query(
                "INSERT INTO grade_events(user_id,event_key,kind,from_grade,to_grade,checkpoint) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
                [
                    row.user_id,
                    `${submissionId}:${event.kind}:${index}`,
                    event.kind,
                    event.fromGrade,
                    event.toGrade,
                    result.state.checkpoint,
                ],
            );
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function loadUserForUpdate(client: PoolClient, userId: string): Promise<GradeState> {
    const result = await client.query(
        "SELECT grade,verified_solves,grade_checkpoint,champions_eligible,last_first_accepted_at,last_demoted_at FROM users WHERE id=$1 FOR UPDATE",
        [userId],
    );
    if (!result.rows[0]) throw new Error("user not found");
    const user = result.rows[0];
    return {
        grade: user.grade,
        verifiedSolves: user.verified_solves,
        checkpoint: user.grade_checkpoint,
        championsEligible: user.champions_eligible,
        lastFirstAcceptedAt: user.last_first_accepted_at,
        lastDemotedAt: user.last_demoted_at,
    };
}
