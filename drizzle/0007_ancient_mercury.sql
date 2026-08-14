ALTER TABLE "problems" ADD COLUMN "execution_mode" text DEFAULT 'stdio' NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "function_spec" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "arguments_json" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "expected_value" jsonb;