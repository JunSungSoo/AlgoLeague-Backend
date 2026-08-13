ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_language" "language" DEFAULT 'python' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "name" = "nickname", "phone" = 'legacy:' || "id"::text, "phone_verified_at" = NOW() WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone_verified_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_uq" ON "users" USING btree ("nickname");
