CREATE TYPE "public"."generation_state" AS ENUM('REQUESTED', 'GENERATING', 'GENERATED', 'SCHEMA_VALIDATED', 'COMPILED', 'FUZZ_VALIDATED', 'MUTATION_VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED_SCHEMA', 'REJECTED_COMPILE', 'REJECTED_WRONG_ANSWER', 'REJECTED_WEAK_TESTS', 'REJECTED_DUPLICATE', 'REJECTED_AMBIGUOUS');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('python', 'java', 'javascript', 'cpp');--> statement-breakpoint
CREATE TYPE "public"."problem_status" AS ENUM('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'INVALIDATED', 'PRACTICE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('LEARNER', 'OPERATOR', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('QU', 'RN', 'AC', 'WA', 'CE', 'RE', 'TLE', 'OLE', 'SE', 'JH', 'IE');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"kst_day" text NOT NULL,
	"source" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" "generation_state" DEFAULT 'REQUESTED' NOT NULL,
	"grade" integer NOT NULL,
	"blueprint_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"seed" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"package" jsonb,
	"report" jsonb,
	"failure_reason" text,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"from_grade" integer NOT NULL,
	"to_grade" integer NOT NULL,
	"checkpoint" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "problem_status" DEFAULT 'DRAFT' NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"input_description" text NOT NULL,
	"output_description" text NOT NULL,
	"constraints" jsonb NOT NULL,
	"samples" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"grade" integer NOT NULL,
	"primary_tag" text NOT NULL,
	"secondary_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"time_limit_ms" integer DEFAULT 2000 NOT NULL,
	"published_at" timestamp with time zone,
	"leaked_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solved_problems" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "solved_problems_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"language" "language" NOT NULL,
	"source_code" text NOT NULL,
	"verdict" "verdict" DEFAULT 'QU' NOT NULL,
	"runtime_ms" integer,
	"memory_kb" integer,
	"attempt_number" integer NOT NULL,
	"counts_for_grade" boolean DEFAULT true NOT NULL,
	"first_accepted" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"trace_id" text NOT NULL,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	"group_name" text DEFAULT 'default' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"nickname" text NOT NULL,
	"role" "role" DEFAULT 'LEARNER' NOT NULL,
	"grade" integer DEFAULT 9 NOT NULL,
	"verified_solves" integer DEFAULT 0 NOT NULL,
	"grade_checkpoint" integer DEFAULT 0 NOT NULL,
	"champions_eligible" boolean DEFAULT false NOT NULL,
	"last_first_accepted_at" timestamp with time zone,
	"last_demoted_at" timestamp with time zone,
	"suspended_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_events" ADD CONSTRAINT "grade_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solved_problems" ADD CONSTRAINT "solved_problems_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solved_problems" ADD CONSTRAINT "solved_problems_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solved_problems" ADD CONSTRAINT "solved_problems_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_user_day_idx" ON "assignments" USING btree ("user_id","kst_day");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_queue_idx" ON "generation_jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_events_key_uq" ON "grade_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "grade_events_user_idx" ON "grade_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "problems_slug_version_uq" ON "problems" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "problems_catalog_idx" ON "problems" USING btree ("status","grade");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_user_problem_idx" ON "submissions" USING btree ("user_id","problem_id");--> statement-breakpoint
CREATE INDEX "submissions_queue_idx" ON "submissions" USING btree ("verdict","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_cases_problem_ordinal_uq" ON "test_cases" USING btree ("problem_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_grade_idx" ON "users" USING btree ("grade");
