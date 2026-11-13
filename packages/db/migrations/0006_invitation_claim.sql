ALTER TABLE "user" ADD COLUMN "signup_txid" bigint;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "claimed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_claimed_user_id_user_id_fk" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_signup_txid_idx" ON "user" USING btree ("signup_txid");--> statement-breakpoint
CREATE INDEX "invitation_live_email_idx" ON "invitation" USING btree (lower("email")) WHERE "invitation"."claimed_at" IS NULL AND "invitation"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_token_hash_len_check" CHECK (octet_length("invitation"."token_hash") = 32);--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_claim_pair_check" CHECK (("invitation"."claimed_user_id" IS NULL) = ("invitation"."claimed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_claimed_check" CHECK ("invitation"."accepted_at" IS NULL OR "invitation"."claimed_at" IS NOT NULL);