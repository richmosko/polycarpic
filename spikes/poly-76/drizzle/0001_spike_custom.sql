-- Custom migration (hand-written; Drizzle Kit has no FORCE RLS, triggers, functions, grants or ownership switching).
-- Runs as session_user poly_migrator with SET ROLE poly_owner active (set by bin/migrate).

-- (e) FORCE ROW LEVEL SECURITY: not expressible in the Drizzle schema, so the generator never sees it and never diffs it.
ALTER TABLE "spike_vault" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- (c) trigger + SECURITY DEFINER function, owned by poly_owner (the active role).
CREATE FUNCTION public.spike_note_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN NEW.touched_at := clock_timestamp(); RETURN NEW; END $$;--> statement-breakpoint
CREATE TRIGGER spike_note_touch_trg BEFORE INSERT ON public.spike_note FOR EACH ROW EXECUTE FUNCTION public.spike_note_touch();--> statement-breakpoint

-- (e) grants, then a definer function owned by a different NOLOGIN role (poly_authz) via SET ROLE.
GRANT SELECT ON public.spike_vault TO poly_app, poly_authz;--> statement-breakpoint
SET ROLE poly_authz;--> statement-breakpoint
CREATE FUNCTION public.spike_authz_probe() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT count(*)::int FROM public.spike_vault $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.spike_authz_probe() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.spike_authz_probe() TO poly_app;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint

-- (b') ARCH 3.1c grants for BetterAuth on the routing-pool role poly_app.
GRANT SELECT, INSERT ON public."user" TO poly_app;--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, created_at, updated_at) ON public."user" TO poly_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session, public.account, public.verification TO poly_app;--> statement-breakpoint
GRANT SELECT ON public.spike_doc TO poly_app;
