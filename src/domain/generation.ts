import { z } from "zod";

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

export const rejectedGenerationStates = [
    "REJECTED_SCHEMA",
    "REJECTED_COMPILE",
    "REJECTED_WRONG_ANSWER",
    "REJECTED_WEAK_TESTS",
    "REJECTED_DUPLICATE",
    "REJECTED_AMBIGUOUS",
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
    samples: z.array(z.object({ input: z.string(), output: z.string() })).min(1),
    hiddenTests: z.array(z.object({ input: z.string(), output: z.string() })).min(2),
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

export type AutomaticPublicationReport = {
    schema: boolean;
    samples: boolean;
    crossLanguage: boolean;
    mutationScore: number;
    duplicateScore: number;
    ambiguityScore: number;
    failures: string[];
};

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
