-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- Ends on poly_owner: tracking rows are inserted by the active role, and only poly_owner may insert (ARCH §6.2).

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint

-- The tracking schema is created by poly_owner before this file runs; the apps only read it, for the schema-behind-image guard.
GRANT USAGE ON SCHEMA drizzle TO poly_app, poly_worker;--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO poly_app, poly_worker;--> statement-breakpoint

-- Application schema: nothing to PUBLIC.
CREATE SCHEMA app AUTHORIZATION poly_owner;--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;--> statement-breakpoint

-- Policies read request context only through this function (A-3: the nullif matters, a reused backend returns '' not NULL).
-- Invoker, fully qualified, no SET clause: that keeps it inlinable.
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.current_user_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;--> statement-breakpoint

-- BetterAuth's tables carry no entity RLS (ARCH §3.1c); poly_app's grants are column-exact. The user row is never
-- deleted, its id and created_at never updated; the later features that add columns add their own grants.
GRANT SELECT, INSERT ON public."user" TO poly_app;--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, updated_at) ON public."user" TO poly_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session, public.account, public.verification TO poly_app;--> statement-breakpoint

-- app.job_targets(job): the one place a system job learns its principal (ARCH §3.3; POLY-83 ruling R4). Definer, owned
-- by poly_authz, executable by poly_worker alone. The tables it reads land with tenancy and import; until then the body
-- returns no rows, and each job's feature extends it with CREATE OR REPLACE under this same pattern.
-- A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_authz;--> statement-breakpoint
SET ROLE poly_authz;--> statement-breakpoint
CREATE FUNCTION app.job_targets(text)
  RETURNS TABLE (entity_id uuid, principal_user_id uuid, connection_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$ SELECT NULL::uuid, NULL::uuid, NULL::uuid WHERE false $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.job_targets(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.job_targets(text) TO poly_worker;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz;
