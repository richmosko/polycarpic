CREATE TABLE "app"."email_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "email_challenge_purpose_check" CHECK ("app"."email_challenge"."purpose" IN ('first_enrolment','account_deletion'))
);
--> statement-breakpoint
CREATE TABLE "app"."enrolment_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_xid" "xid8",
	"consumed_by" text,
	"stamped_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "enrolment_grant_consumed_by_check" CHECK ("app"."enrolment_grant"."consumed_by" IS NULL OR "app"."enrolment_grant"."consumed_by" IN ('totp','passkey'))
);
--> statement-breakpoint
ALTER TABLE "two_factor" ALTER COLUMN "verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "two_factor" ALTER COLUMN "verified" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."email_challenge" ADD CONSTRAINT "email_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_challenge" ADD CONSTRAINT "email_challenge_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enrolment_grant" ADD CONSTRAINT "enrolment_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."enrolment_grant" ADD CONSTRAINT "enrolment_grant_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_challenge_user_idx" ON "app"."email_challenge" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_grant_one_open" ON "app"."enrolment_grant" USING btree ("user_id") WHERE "app"."enrolment_grant"."consumed_at" IS NULL AND "app"."enrolment_grant"."revoked_at" IS NULL AND "app"."enrolment_grant"."session_id" IS NOT NULL;