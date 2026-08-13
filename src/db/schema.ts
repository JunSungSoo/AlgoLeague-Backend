import { relations, sql } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["LEARNER", "OPERATOR", "ADMIN"]);
export const problemStatusEnum = pgEnum("problem_status", [
    "DRAFT",
    "REVIEW",
    "SCHEDULED",
    "PUBLISHED",
    "INVALIDATED",
    "PRACTICE",
]);
export const verdictEnum = pgEnum("verdict", [
    "QU",
    "RN",
    "AC",
    "WA",
    "CE",
    "RE",
    "TLE",
    "OLE",
    "SE",
    "JH",
    "IE",
]);
export const languageEnum = pgEnum("language", ["python", "java", "javascript", "cpp"]);
export const generationStateEnum = pgEnum("generation_state", [
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
    "REJECTED_SCHEMA",
    "REJECTED_COMPILE",
    "REJECTED_WRONG_ANSWER",
    "REJECTED_WEAK_TESTS",
    "REJECTED_DUPLICATE",
    "REJECTED_AMBIGUOUS",
]);

const timestamps = {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
    "users",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        username: text("username").notNull(),
        email: text("email"),
        passwordHash: text("password_hash"),
        name: text("name").notNull(),
        phone: text("phone").notNull(),
        phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }).notNull(),
        nickname: text("nickname").notNull(),
        nicknameChangedAt: timestamp("nickname_changed_at", { withTimezone: true }),
        address: text("address"),
        profileImageUrl: text("profile_image_url"),
        preferredLanguage: languageEnum("preferred_language").notNull().default("python"),
        role: roleEnum("role").notNull().default("LEARNER"),
        grade: integer("grade").notNull().default(9),
        verifiedSolves: integer("verified_solves").notNull().default(0),
        gradeCheckpoint: integer("grade_checkpoint").notNull().default(0),
        championsEligible: boolean("champions_eligible").notNull().default(false),
        lastFirstAcceptedAt: timestamp("last_first_accepted_at", { withTimezone: true }),
        lastDemotedAt: timestamp("last_demoted_at", { withTimezone: true }),
        suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
        ...timestamps,
    },
    (table) => [
        uniqueIndex("users_username_uq").on(table.username),
        uniqueIndex("users_email_uq").on(table.email),
        uniqueIndex("users_phone_uq").on(table.phone),
        uniqueIndex("users_nickname_uq").on(table.nickname),
        index("users_grade_idx").on(table.grade),
    ],
);

export const sessions = pgTable(
    "sessions",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull(),
        scopes: text("scopes")
            .array()
            .notNull()
            .default(sql`ARRAY[]::text[]`),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
        index("sessions_user_idx").on(table.userId),
    ],
);

export const problems = pgTable(
    "problems",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        slug: text("slug").notNull(),
        version: integer("version").notNull().default(1),
        status: problemStatusEnum("status").notNull().default("DRAFT"),
        title: text("title").notNull(),
        statement: text("statement").notNull(),
        inputDescription: text("input_description").notNull(),
        outputDescription: text("output_description").notNull(),
        constraints: jsonb("constraints").$type<string[]>().notNull(),
        samples: jsonb("samples").$type<Array<{ input: string; output: string }>>().notNull(),
        explanation: text("explanation").notNull(),
        grade: integer("grade").notNull(),
        primaryTag: text("primary_tag").notNull(),
        secondaryTags: text("secondary_tags")
            .array()
            .notNull()
            .default(sql`ARRAY[]::text[]`),
        timeLimitMs: integer("time_limit_ms").notNull().default(2000),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        leakedAt: timestamp("leaked_at", { withTimezone: true }),
        invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
        ...timestamps,
    },
    (table) => [
        uniqueIndex("problems_slug_version_uq").on(table.slug, table.version),
        index("problems_catalog_idx").on(table.status, table.grade),
    ],
);

export const testCases = pgTable(
    "test_cases",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        problemId: uuid("problem_id")
            .notNull()
            .references(() => problems.id, { onDelete: "cascade" }),
        input: text("input").notNull(),
        expectedOutput: text("expected_output").notNull(),
        groupName: text("group_name").notNull().default("default"),
        isPublic: boolean("is_public").notNull().default(false),
        ordinal: integer("ordinal").notNull(),
    },
    (table) => [uniqueIndex("test_cases_problem_ordinal_uq").on(table.problemId, table.ordinal)],
);

export const assignments = pgTable(
    "assignments",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        problemId: uuid("problem_id")
            .notNull()
            .references(() => problems.id),
        kstDay: text("kst_day").notNull(),
        source: text("source").notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index("assignments_user_day_idx").on(table.userId, table.kstDay),
        uniqueIndex("assignments_user_problem_uq").on(table.userId, table.problemId),
    ],
);

export const submissions = pgTable(
    "submissions",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        problemId: uuid("problem_id")
            .notNull()
            .references(() => problems.id),
        language: languageEnum("language").notNull(),
        sourceCode: text("source_code").notNull(),
        verdict: verdictEnum("verdict").notNull().default("QU"),
        runtimeMs: integer("runtime_ms"),
        memoryKb: integer("memory_kb"),
        attemptNumber: integer("attempt_number").notNull(),
        countsForGrade: boolean("counts_for_grade").notNull().default(true),
        firstAccepted: boolean("first_accepted").notNull().default(false),
        errorMessage: text("error_message"),
        traceId: text("trace_id").notNull(),
        judgedAt: timestamp("judged_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index("submissions_user_problem_idx").on(table.userId, table.problemId),
        index("submissions_queue_idx").on(table.verdict, table.createdAt),
    ],
);

export const solvedProblems = pgTable(
    "solved_problems",
    {
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        problemId: uuid("problem_id")
            .notNull()
            .references(() => problems.id),
        submissionId: uuid("submission_id")
            .notNull()
            .references(() => submissions.id),
        acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
        voidedAt: timestamp("voided_at", { withTimezone: true }),
    },
    (table) => [primaryKey({ columns: [table.userId, table.problemId] })],
);

export const gradeEvents = pgTable(
    "grade_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        eventKey: text("event_key").notNull(),
        kind: text("kind").notNull(),
        fromGrade: integer("from_grade").notNull(),
        toGrade: integer("to_grade").notNull(),
        checkpoint: integer("checkpoint").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("grade_events_key_uq").on(table.eventKey),
        index("grade_events_user_idx").on(table.userId),
    ],
);

export const generationJobs = pgTable(
    "generation_jobs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        state: generationStateEnum("state").notNull().default("REQUESTED"),
        grade: integer("grade").notNull(),
        blueprintVersion: text("blueprint_version").notNull(),
        promptVersion: text("prompt_version").notNull(),
        model: text("model").notNull(),
        seed: integer("seed").notNull(),
        attempts: integer("attempts").notNull().default(0),
        package: jsonb("package"),
        report: jsonb("report").$type<Record<string, unknown>>(),
        failureReason: text("failure_reason"),
        scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
        ...timestamps,
    },
    (table) => [index("generation_jobs_queue_idx").on(table.state, table.createdAt)],
);

export const auditLogs = pgTable(
    "audit_logs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        actorId: uuid("actor_id").references(() => users.id),
        action: text("action").notNull(),
        targetType: text("target_type").notNull(),
        targetId: text("target_id").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
        ipHash: text("ip_hash"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("audit_target_idx").on(table.targetType, table.targetId)],
);

export const userRelations = relations(users, ({ many }) => ({
    submissions: many(submissions),
    assignments: many(assignments),
    gradeEvents: many(gradeEvents),
}));
export const problemRelations = relations(problems, ({ many }) => ({
    submissions: many(submissions),
    tests: many(testCases),
    assignments: many(assignments),
}));
