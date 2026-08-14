ALTER TABLE "problems" ADD COLUMN "content_fingerprint" text;--> statement-breakpoint
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY lower(regexp_replace(title, '[^[:alnum:]가-힣]', '', 'g'))
               ORDER BY created_at, id
           ) AS duplicate_rank
    FROM problems
    WHERE status = 'PUBLISHED'
)
UPDATE problems
SET status = 'INVALIDATED', invalidated_at = now(), updated_at = now()
FROM ranked
WHERE problems.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint
UPDATE problems
SET content_fingerprint = md5(
    lower(regexp_replace(statement, '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(input_description, '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(output_description, '\\s+', ' ', 'g'))
)
WHERE status = 'PUBLISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "problems_published_title_key_uq" ON "problems" USING btree (lower(regexp_replace("title", '[^[:alnum:]가-힣]', '', 'g'))) WHERE "problems"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "problems_published_fingerprint_uq" ON "problems" USING btree ("content_fingerprint") WHERE "problems"."status" = 'PUBLISHED' and "problems"."content_fingerprint" is not null;
