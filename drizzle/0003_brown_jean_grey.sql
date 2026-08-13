ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "users" SET "username" = 'legacy_' || replace("id"::text, '-', '') WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");
