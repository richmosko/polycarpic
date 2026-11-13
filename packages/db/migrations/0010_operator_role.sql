-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-146 (ruling R2): the operator CLI gets its own login role, poly_operator (created by roles.sql). It alone may execute the
-- issuer; poly_worker loses it. Ends on poly_owner.

SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.issue_operator_invitation(text, bytea, boolean) FROM poly_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.issue_operator_invitation(text, bytea, boolean) TO poly_operator;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO poly_operator;
