-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-149 (ruling R1, R6.2): poly_app loses its reach into BetterAuth's tables and the asserted-user entry is deleted.
-- Order: the REVOKEs, the policy, the function drop (poly_authz), the marker CHECK (poly_owner), audit_membership (poly_govern).

REVOKE ALL ON public."user", public.session, public.account, public.verification, public.two_factor, public.passkey FROM poly_app;--> statement-breakpoint
REVOKE SELECT (id, purpose, created_at, expires_at, attempts, used_at) ON app.email_challenge FROM poly_app;--> statement-breakpoint
DROP POLICY email_challenge_own ON app.email_challenge;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint
DROP FUNCTION app.enter_asserted_user(uuid, uuid);--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
-- Addendum 7: FORCE RLS hides every row from the owner, so the delete runs under a policy that lives only for this statement. The lock
-- waits for any open marker and keeps new ones out until the CHECK below is in place.
LOCK TABLE app.tx_identity IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
-- The DELETE's WHERE reads kind, so the owner needs a SELECT policy for the same rows as well.
CREATE POLICY tx_identity_drop_web_read ON app.tx_identity FOR SELECT TO poly_owner USING (kind = 'web');--> statement-breakpoint
CREATE POLICY tx_identity_drop_web ON app.tx_identity FOR DELETE TO poly_owner USING (kind = 'web');--> statement-breakpoint
DELETE FROM app.tx_identity WHERE kind = 'web';--> statement-breakpoint
DROP POLICY tx_identity_drop_web ON app.tx_identity;--> statement-breakpoint
DROP POLICY tx_identity_drop_web_read ON app.tx_identity;--> statement-breakpoint
ALTER TABLE app.tx_identity DROP CONSTRAINT tx_identity_kind_check;--> statement-breakpoint
ALTER TABLE app.tx_identity ADD CONSTRAINT tx_identity_kind_check
  CHECK (kind IN ('signup', 'auth', 'session') OR kind ~ '^system:[a-z][a-z0-9_]{0,62}$');--> statement-breakpoint

GRANT CREATE ON SCHEMA app TO poly_govern;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.audit_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_actor text := coalesce(
      (SELECT CASE t.kind WHEN 'signup' THEN 'user' WHEN 'auth' THEN 'user' WHEN 'session' THEN 'user' ELSE t.kind END
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
REVOKE CREATE ON SCHEMA app FROM poly_govern;
