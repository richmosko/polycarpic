CREATE TABLE "app"."mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tx" "xid8" DEFAULT pg_catalog.pg_current_xact_id() NOT NULL,
	"to_address" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"last_status" integer,
	CONSTRAINT "mail_outbox_user_kind_tx_unique" UNIQUE("user_id","kind","tx"),
	CONSTRAINT "mail_outbox_kind_check" CHECK ("app"."mail_outbox"."kind" IN ('method_added','method_removed','backup_codes_replaced','backup_code_used','password_changed'))
);
--> statement-breakpoint
CREATE TABLE "app"."method_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"two_factor_id" uuid,
	"passkey_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usable_at" timestamp with time zone NOT NULL,
	"cancel_hash" "bytea",
	"cancelled_at" timestamp with time zone,
	"mail_id" uuid NOT NULL,
	"notice_sent_at" timestamp with time zone,
	CONSTRAINT "method_hold_two_factor_id_unique" UNIQUE("two_factor_id"),
	CONSTRAINT "method_hold_passkey_id_unique" UNIQUE("passkey_id"),
	CONSTRAINT "method_hold_method_check" CHECK ("app"."method_hold"."method" IN ('totp','passkey')),
	CONSTRAINT "method_hold_one_method_check" CHECK (pg_catalog.num_nonnulls("app"."method_hold"."two_factor_id", "app"."method_hold"."passkey_id") = 1),
	CONSTRAINT "method_hold_cancel_hash_check" CHECK ("app"."method_hold"."cancel_hash" IS NULL OR pg_catalog.octet_length("app"."method_hold"."cancel_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "app"."mail_outbox" ADD CONSTRAINT "mail_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."method_hold" ADD CONSTRAINT "method_hold_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_unsent_idx" ON "app"."mail_outbox" USING btree ("created_at") WHERE "app"."mail_outbox"."sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "method_hold_user_open_idx" ON "app"."method_hold" USING btree ("user_id") WHERE "app"."method_hold"."cancelled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "method_hold_mail_idx" ON "app"."method_hold" USING btree ("mail_id");--> statement-breakpoint
CREATE INDEX "audit_event_subject_kind_idx" ON "audit_event" USING btree ("subject_user_id","kind","created_at");