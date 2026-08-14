import { z } from "zod";
import { functionSpecSchema, functionTestSchema } from "./function-spec";
import { dayjs } from "../lib/dayjs-config";

export const generationStates = [
    "REQUESTED",
    "GENERATING",
    "GENERATED",
    "SCHEMA_VALIDATED",
    "COMPILED",
    "FUZZ_VALIDATED",
    "MUTATION_VALIDATED",
    "REVIEW_REQUIRED",
    "APPROVED",
    "SCHEDULED",
    "PUBLISHED",
] as const;

export const activeGenerationStates = [
    "REQUESTED",
    "GENERATING",
    "GENERATED",
    "SCHEMA_VALIDATED",
    "COMPILED",
    "FUZZ_VALIDATED",
    "MUTATION_VALIDATED",
] as const;

export const GENERATION_JOB_STALE_MINUTES = 30;

export function operationalGenerationState(
    state: string,
    workerOnline: boolean,
    updatedAt?: Date,
    now = dayjs().toDate(),
) {
    const active = activeGenerationStates.some((activeState) => activeState === state);
    if (!active) return state;
    if (!workerOnline) return "STOPPED";
    if (
        state !== "REQUESTED" &&
        updatedAt &&
        dayjs(now).diff(dayjs(updatedAt), "minute", true) >= GENERATION_JOB_STALE_MINUTES
    )
        return "STOPPED";
    return state;
}

export const rejectedGenerationStates = [
    "REJECTED_SCHEMA",
    "REJECTED_COMPILE",
    "REJECTED_WRONG_ANSWER",
    "REJECTED_WEAK_TESTS",
    "REJECTED_DUPLICATE",
    "REJECTED_AMBIGUOUS",
    "REJECTED_REVIEW",
] as const;

export const problemPackageSchema = z.object({
    title: z.string().min(5).max(100),
    statement: z.string().min(100),
    input: z.string().min(10),
    output: z.string().min(10),
    constraints: z.array(z.string()).min(1),
    grade: z.number().int().min(1).max(9),
    primaryTag: z.string().min(1),
    secondaryTags: z.array(z.string()),
    functionSpec: functionSpecSchema,
    samples: z.array(functionTestSchema).length(3),
    hiddenTests: z.array(functionTestSchema).min(5),
    explanation: z.string().min(50),
    solutions: z.object({
        python: z.string(),
        java: z.string(),
        javascript: z.string(),
        cpp: z.string(),
    }),
    oracle: z.string().min(20),
    generatorSeed: z.number().int(),
    blueprintVersion: z.string(),
});

export type ProblemPackage = z.infer<typeof problemPackageSchema>;

export function requiresHumanReview(grade: number, champions = false) {
    return champions || grade === 1;
}

export const automaticPublicationReportSchema = z.object({
    schema: z.boolean(),
    samples: z.boolean(),
    crossLanguage: z.boolean(),
    mutationScore: z.number().min(0).max(1),
    duplicateScore: z.number().min(0).max(1),
    ambiguityScore: z.number().min(0).max(1),
    failures: z.array(z.string()),
});

export type AutomaticPublicationReport = z.infer<typeof automaticPublicationReportSchema>;

export function canAutoPublish(
    grade: number,
    champions: boolean,
    report: AutomaticPublicationReport,
) {
    return (
        !requiresHumanReview(grade, champions) &&
        grade >= 2 &&
        grade <= 9 &&
        report.failures.length === 0 &&
        report.schema &&
        report.samples &&
        report.crossLanguage &&
        report.mutationScore >= 0.8 &&
        report.duplicateScore <= 0.15 &&
        report.ambiguityScore <= 0.1
    );
}
