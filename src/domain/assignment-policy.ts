import type { Grade } from "./grade-policy";
import { canAccessProblem } from "./grade-policy";
import { dayjs } from "../lib/dayjs-config";

export type AssignmentCandidate = {
    id: string;
    grade: Grade;
    primaryTag: string;
    secondaryTags: string[];
    publishedAt: Date;
};

export function chooseNextProblem(
    userGrade: Grade,
    candidates: AssignmentCandidate[],
    solvedIds: Set<string>,
    previous?: AssignmentCandidate,
) {
    const available = candidates.filter(
        (problem) =>
            canAccessProblem(userGrade, problem.grade) &&
            !solvedIds.has(problem.id) &&
            problem.id !== previous?.id,
    );
    const differentPrimary = available.filter(
        (problem) => problem.primaryTag !== previous?.primaryTag,
    );
    const differentSecondary = available.filter(
        (problem) => !problem.secondaryTags.some((tag) => previous?.secondaryTags.includes(tag)),
    );
    const newest = (items: AssignmentCandidate[]) =>
        [...items].sort((a, b) => dayjs(b.publishedAt).diff(dayjs(a.publishedAt)))[0];
    return newest(differentPrimary) ?? newest(differentSecondary) ?? newest(available) ?? null;
}

export function kstDayKey(date: Date) {
    return dayjs(date).tz().format("YYYY-MM-DD");
}
