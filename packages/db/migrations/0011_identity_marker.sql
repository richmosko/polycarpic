-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-147 (ruling R1, R2): identity is a per-transaction marker row, written only by the enter_* definers and read only by
-- app.current_user_id() / app.current_session_id(). Nothing reads app.user_id or app.session_id any more. No policy body changes.
-- Ends on poly_owner.

CREATE TABLE app.tx_identity (
  xid        pg_catalog.xid8 PRIMARY KEY,
  user_id    uuid NOT NULL,
  session_id uuid,
  kind       text NOT NULL CHECK (kind IN ('web', 'signup') OR kind ~ '^system:[a-z][a-z0-9_]{0,62}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);--> statement-breakpoint
ALTER TABLE app.tx_identity ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.tx_identity FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.tx_identity FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON app.tx_identity TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;--> statement-breakpoint
GRANT INSERT ON app.tx_identity TO poly_authz;--> statement-breakpoint
GRANT DELETE ON app.tx_identity TO poly_purge;--> statement-breakpoint
-- A reader sees only its own transaction's row. The read side never calls pg_current_xact_id(), which would assign an id.
CREATE POLICY tx_identity_own ON app.tx_identity FOR SELECT
  TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal
  USING (xid = pg_catalog.pg_current_xact_id_if_assigned());--> statement-breakpoint
CREATE POLICY tx_identity_enter ON app.tx_identity FOR INSERT TO poly_authz
  WITH CHECK (xid = pg_catalog.pg_current_xact_id());--> statement-breakpoint
-- DELETE with a WHERE needs the rows to pass a SELECT policy too, so the purge role sees every row; it is NOLOGIN, reached only by its definer.
CREATE POLICY tx_identity_purge_read ON app.tx_identity FOR SELECT TO poly_purge USING (true);--> statement-breakpoint
-- NULL status counts as finished: pg_xact_status is NULL for an xid older than the retained commit log, which cannot be in progress.
CREATE POLICY tx_identity_purge ON app.tx_identity FOR DELETE TO poly_purge
  USING (created_at < pg_catalog.now() - interval '1 hour'
         AND pg_catalog.pg_xact_status(xid) IS DISTINCT FROM 'in progress');--> statement-breakpoint

-- No TRUNCATE (a superuser's included), like the tenancy tables (0003); the purge is the definer's DELETE alone.
CREATE TRIGGER tx_identity_no_truncate BEFORE TRUNCATE ON app.tx_identity FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- The readers. Invoker, no SET clause, grants unchanged for current_user_id (0001). A transaction that wrote no marker has no xid,
-- the key is NULL, and the result is NULL: it fails closed.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT t.user_id FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() $$;--> statement-breakpoint
CREATE FUNCTION app.current_session_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT t.session_id FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.current_session_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_session_id() TO poly_app;--> statement-breakpoint

-- A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_authz, poly_purge, poly_govern;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint

-- Each enter_* refuses unless the client's statement is exactly its own call (Principal, 2026-11-14): injected text cannot bind
-- parameters, so no fragment can call a definer. The comparison is IS DISTINCT FROM, never <> (a NULL must refuse too).
CREATE FUNCTION app.enter_asserted_user(p_user uuid, p_session uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.enter_asserted_user($1, $2)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_user IS NULL OR p_session IS NULL THEN
      RAISE EXCEPTION 'identity is required' USING ERRCODE = '22004';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()) THEN
      RAISE EXCEPTION 'this transaction already has an identity' USING ERRCODE = '42501';
    END IF;
    -- Catches earlier writes, not earlier reads (ARCH §3.3).
    IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
      RAISE EXCEPTION 'the identity marker must be the first write of its transaction' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_catalog.pg_current_xact_id(), p_user, p_session, 'web');
    RETURN pg_catalog.pg_current_xact_id()::pg_catalog.text;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_asserted_user(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_asserted_user(uuid, uuid) TO poly_app;--> statement-breakpoint

CREATE FUNCTION app.enter_job(p_job text, p_entity uuid, p_connection uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_n bigint;
    v_principal uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.enter_job($1, $2, $3)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_job IS NULL OR p_job !~ '^[a-z][a-z0-9_]{0,62}$' THEN
      RAISE EXCEPTION 'invalid job name' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()) THEN
      RAISE EXCEPTION 'this transaction already has an identity' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
      RAISE EXCEPTION 'the identity marker must be the first write of its transaction' USING ERRCODE = '42501';
    END IF;
    SELECT pg_catalog.count(*), (pg_catalog.array_agg(j.principal_user_id))[1] INTO v_n, v_principal
      FROM app.job_targets(p_job) j
      WHERE j.entity_id = p_entity AND j.connection_id IS NOT DISTINCT FROM p_connection;
    IF v_n IS DISTINCT FROM 1 OR v_principal IS NULL THEN
      RAISE EXCEPTION 'job % resolved no single principal', p_job USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_catalog.pg_current_xact_id(), v_principal, NULL, 'system:' || p_job);
    RETURN pg_catalog.pg_current_xact_id()::pg_catalog.text;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_job(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_job(text, uuid, uuid) TO poly_worker;--> statement-breakpoint

-- enter_job is the only caller of job_targets now: a worker that could list job targets would learn which users link which connections.
REVOKE EXECUTE ON FUNCTION app.job_targets(text) FROM poly_worker;--> statement-breakpoint

-- The sign-up step (0007): same checks, now writing the marker. It runs after the user insert, so there is no xid check.
CREATE OR REPLACE FUNCTION app.enter_new_user(uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.enter_new_user($1)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()) THEN
      RAISE EXCEPTION 'a user is already in context' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = $1 AND u.signup_txid = pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8) THEN
      RAISE EXCEPTION 'not a user created by this transaction' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.entity e WHERE e.self_user_id = $1) THEN
      RAISE EXCEPTION 'the user already has a Person' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_catalog.pg_current_xact_id(), $1, NULL, 'signup');
  END
  $fn$;--> statement-breakpoint

SET ROLE poly_purge;--> statement-breakpoint

-- The caller passes nothing, so it cannot choose the age. A marker whose transaction is still in progress is never purged.
CREATE FUNCTION app.purge_tx_identity() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_n integer;
  BEGIN
    DELETE FROM app.tx_identity
      WHERE created_at < pg_catalog.now() - interval '1 hour'
        AND pg_catalog.pg_xact_status(xid) IS DISTINCT FROM 'in progress';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.purge_tx_identity() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_tx_identity() TO poly_worker;--> statement-breakpoint

SET ROLE poly_govern;--> statement-breakpoint

-- withSystem no longer sets app.actor: in a marked transaction the actor comes from the marker's kind, and a forged setting is ignored.
-- The unmarked operator path still labels itself through the setting.
CREATE OR REPLACE FUNCTION app.audit_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_actor text := coalesce(
      (SELECT CASE t.kind WHEN 'web' THEN 'user' WHEN 'signup' THEN 'user' ELSE t.kind END
         FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()),
      nullif(pg_catalog.current_setting('app.actor', true), ''),
      'none');
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (NEW.entity_id, app.current_user_id(), v_actor, 'membership.created', NEW.user_id, jsonb_build_object('role', NEW.role));
    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (NEW.entity_id, app.current_user_id(), v_actor, 'membership.role_changed', NEW.user_id,
              jsonb_build_object('from', OLD.role, 'to', NEW.role));
    ELSE
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (OLD.entity_id, app.current_user_id(), v_actor, 'membership.removed', OLD.user_id, jsonb_build_object('role', OLD.role));
    END IF;
    RETURN NULL;
  END
  $$;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_purge, poly_govern;
