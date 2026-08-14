ALTER TABLE "submissions" ADD COLUMN "runtime_version" text;
--> statement-breakpoint
UPDATE "submissions"
SET "runtime_version" = CASE "language"
    WHEN 'javascript' THEN 'node24'
    WHEN 'python' THEN 'python3.14'
    WHEN 'java' THEN 'java25'
    WHEN 'cpp' THEN 'cpp23-gcc15'
    ELSE NULL
END
WHERE "runtime_version" IS NULL;
