-- POLY-86 (ruling R8, seceng S16a): grants for 0004's tables, and column-level INSERT/UPDATE on the two columns only
-- POLY-89's definers may write. A table-level INSERT grant covers every column, so INSERT on "user" and "session" is
-- re-issued as column lists without second_step_at and recent_auth_at. user.two_factor_enabled is inserted by
-- BetterAuth (default false) but never updated by poly_app: the enrolment routes answer 403 until POLY-89.
REVOKE INSERT, UPDATE ON public."user" FROM poly_app;--> statement-breakpoint
GRANT INSERT (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at) ON public."user" TO poly_app;--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, updated_at) ON public."user" TO poly_app;--> statement-breakpoint
REVOKE INSERT, UPDATE ON public.session FROM poly_app;--> statement-breakpoint
GRANT INSERT (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) ON public.session TO poly_app;--> statement-breakpoint
GRANT UPDATE (expires_at, token, updated_at, ip_address, user_agent) ON public.session TO poly_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.two_factor, public.passkey TO poly_app;
