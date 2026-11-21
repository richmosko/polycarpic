-- The deploy gate behind INFRA §7.1 step 16. Read-only: one SELECT. It prints one `FAIL ...` line per broken
-- control and nothing else; when none is broken it prints the single line `gate: pass`. Run through gate-check.sh,
-- which turns any FAIL (or any error, or a missing `gate: pass`) into a non-zero exit.
-- "Login role" = every role that can log in and is not a superuser; the effective privilege (membership and PUBLIC
-- included) is read with has_*_privilege. poly_backup's read of the sign-in record, through pg_read_all_data, is the
-- one allowed exception (it reads every table); poly_backup's writes are not.
WITH logins AS (
  SELECT rolname::text AS r FROM pg_roles WHERE rolcanlogin AND NOT rolsuper
), runtime AS (
  SELECT r FROM logins WHERE r <> 'poly_backup'
), tbls(t) AS (
  VALUES ('app.second_step_streak'), ('app.sign_in_record'), ('app.method_hold'), ('app.mail_outbox')
), tbls_read(t) AS (
  -- POLY-137: the two new tables are read by no runtime login role (poly_backup reads them through pg_read_all_data)
  VALUES ('app.method_hold'), ('app.mail_outbox')
), betterauth(t) AS (
  VALUES ('public."user"'), ('public.session'), ('public.account'), ('public.verification'),
         ('public.two_factor'), ('public.passkey')
), trig(tbl, name) AS (
  VALUES ('public.two_factor', 'two_factor_15_lock'), ('public.two_factor', 'two_factor_16_lock_delete'),
         ('public.session', 'session_80_sign_in_record'),
         ('app.sign_in_record', 'sign_in_record_05_refuse'), ('app.sign_in_record', 'sign_in_record_10_immutable'),
         ('app.sign_in_record', 'sign_in_record_no_truncate'),
         ('public.two_factor', 'two_factor_80_sync'), ('public.passkey', 'passkey_80_sync'),
         ('public.two_factor', 'two_factor_85_step_up_spent'), ('app.step_up_totp', 'step_up_totp_10_forward'),
         ('app.step_up_pending', 'step_up_pending_resolved'),
         ('public.two_factor', 'two_factor_no_truncate'), ('public.passkey', 'passkey_no_truncate'),
         -- POLY-137 R3.8 lines 16 and 20: the hold's guards and the three notice triggers
         ('public.two_factor', 'two_factor_12_method_hold'), ('public.passkey', 'passkey_12_method_hold'),
         ('public."user"', 'user_21_email_fixed'), ('public.two_factor', 'two_factor_84_codes_replaced'),
         ('public.account', 'account_80_password_changed')
), trig_fn(tbl, name, fn) AS (
  VALUES ('public.two_factor', 'two_factor_12_method_hold', 'app.guard_method_hold()'),
         ('public.passkey', 'passkey_12_method_hold', 'app.guard_method_hold()'),
         ('public."user"', 'user_21_email_fixed', 'app.refuse_email_change()'),
         ('public.two_factor', 'two_factor_84_codes_replaced', 'app.note_codes_replaced()'),
         ('public.account', 'account_80_password_changed', 'app.note_password_changed()')
), trig_def(tbl, name, frag) AS (
  VALUES ('public.two_factor', 'two_factor_12_method_hold', 'BEFORE UPDATE OF failed_verification_count, backup_codes'),
         ('public.passkey', 'passkey_12_method_hold', 'BEFORE UPDATE OF counter')
), body_chk(sig, needle) AS (
  -- Line 17 is a TRIPWIRE, not a proof: a comment in the body would satisfy it. The proof is behavioural (tests/db/auth-method-hold.test.ts,
  -- R3.10 tests 3, 7 and 8); this gate is read-only and cannot run them.
  VALUES ('app.sync_second_step()', 'app.method_hold'), ('app.sync_second_step()', 'app.mail_outbox'),
         ('app.complete_step_up(text,uuid,bigint)', 'method_hold'), ('app.check_factor_removal(uuid,text,uuid)', 'method_hold')
), def137(sig, owner, exec) AS (
  VALUES ('app.method_held(text,uuid)', 'poly_govern', 'poly_auth'), ('app.cancel_method_hold(text)', 'poly_govern', 'poly_auth'),
         ('app.claim_mail()', 'poly_govern', 'poly_worker'), ('app.arm_hold_cancel(uuid,bytea)', 'poly_govern', 'poly_worker'),
         ('app.mail_sent(uuid)', 'poly_govern', 'poly_worker'), ('app.mail_failed(uuid,integer)', 'poly_govern', 'poly_worker'),
         ('app.purge_mail_outbox()', 'poly_purge', 'poly_worker'),
         ('app.note_codes_replaced()', 'poly_govern', NULL), ('app.note_password_changed()', 'poly_govern', NULL)
), cnt(k, n) AS (
  -- Lines 19, 22, 23, 24: what a missed run leaves behind. A count over a table that is missing is 0 here; line 1 names the missing table.
  -- The text of each count is run through query_to_xml (the gate runs as a superuser) so a missing table is a FAIL line, not a failed script.
  SELECT 'mail_unsent', CASE WHEN to_regclass('app.mail_outbox') IS NULL THEN 0 ELSE
    (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM app.mail_outbox WHERE sent_at IS NULL AND created_at < now() - interval ''1 hour''', false, true, '')))[1]::text::bigint END
  UNION ALL
  SELECT 'tx_identity', CASE WHEN to_regclass('app.tx_identity') IS NULL THEN 0 ELSE
    (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM app.tx_identity WHERE created_at < now() - interval ''6 hours'' AND pg_xact_status(xid) IS DISTINCT FROM ''in progress''', false, true, '')))[1]::text::bigint END
  UNION ALL
  SELECT 'sign_in_record', CASE WHEN to_regclass('app.sign_in_record') IS NULL THEN 0 ELSE
    (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM app.sign_in_record WHERE created_at < now() - interval ''401 days''', false, true, '')))[1]::text::bigint END
  UNION ALL
  SELECT 'mail_sent_old', CASE WHEN to_regclass('app.mail_outbox') IS NULL THEN 0 ELSE
    (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM app.mail_outbox WHERE sent_at IS NOT NULL AND created_at < now() - interval ''31 days''', false, true, '')))[1]::text::bigint END
), sync_trig(tbl, name) AS (
  -- the two method-change triggers must run app.sync_second_step(), the function that writes the audit event
  VALUES ('public.two_factor', 'two_factor_80_sync'), ('public.passkey', 'passkey_80_sync')
), definers(sig, owner) AS (
  VALUES ('app.guard_second_step_lock()', 'poly_govern'), ('app.record_session_sign_in()', 'poly_govern'),
         ('app.sync_second_step()', 'poly_govern')
), app_eleven(sig) AS (
  VALUES ('app.current_user_id()'), ('app.current_session_id()'), ('app.has_role(uuid,text)'),
         ('app.visible_entities()'), ('app.owner_count(uuid)'), ('app.second_step_required()'),
         ('app.enter_session(text)'), ('app.my_sessions()'), ('app.recent_auth_ok()'),
         ('app.revoke_my_session(uuid)'), ('app.my_second_step()')
), member_want(m, r, inh, st, adm) AS (
  -- pg_auth_members, both ways (roles.sql is the source): poly_migrator holds the owner and the seven definer-owner roles
  -- (inherit false, set true, admin false); poly_backup holds pg_read_all_data (its inherit and set are not compared).
  SELECT 'poly_migrator', r, false, true, false
  FROM unnest(ARRAY['poly_owner', 'poly_authz', 'poly_purge', 'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal']) r
  UNION ALL SELECT 'poly_backup', 'pg_read_all_data', NULL, NULL, false
), member_have AS (
  SELECT um.rolname::text AS m, ro.rolname::text AS r,
         CASE WHEN um.rolname = 'poly_backup' THEN NULL ELSE a.inherit_option END AS inh,
         CASE WHEN um.rolname = 'poly_backup' THEN NULL ELSE a.set_option END AS st, a.admin_option AS adm
  FROM pg_auth_members a JOIN pg_roles um ON um.oid = a.member JOIN pg_roles ro ON ro.oid = a.roleid
  WHERE um.rolname LIKE 'poly\_%' OR ro.rolname LIKE 'poly\_%' OR um.rolcanlogin
), f(line) AS (
  -- 1. the two tables exist, RLS enabled and forced
  SELECT 'FAIL table ' || t || ': missing' FROM tbls WHERE to_regclass(t) IS NULL
  UNION ALL
  SELECT 'FAIL table ' || t || ': row-level security is not enabled and forced'
  FROM tbls JOIN pg_class c ON c.oid = to_regclass(t) WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)
  -- 2. the triggers exist and are enabled
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': ' ||
         CASE WHEN g.oid IS NULL THEN 'missing' ELSE 'tgenabled = ' || g.tgenabled::text || ', not O' END
  FROM trig LEFT JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE g.oid IS NULL OR g.tgenabled <> 'O'
  -- 3. the two trigger definers: owner, SECURITY DEFINER, executable by no login role
  UNION ALL
  SELECT 'FAIL function ' || sig || ': missing' FROM definers WHERE to_regprocedure(sig) IS NULL
  UNION ALL
  SELECT 'FAIL function ' || sig || ': owner is ' || pg_get_userbyid(p.proowner) || ', not ' || owner
  FROM definers JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE pg_get_userbyid(p.proowner) <> owner
  UNION ALL
  SELECT 'FAIL function ' || sig || ': not SECURITY DEFINER'
  FROM definers JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function ' || sig || ': ' || r || ' can execute it'
  FROM definers CROSS JOIN logins WHERE to_regprocedure(sig) IS NOT NULL AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')
  -- 4. the purge: owner poly_purge, SECURITY DEFINER, executable by poly_worker only
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): missing' WHERE to_regprocedure('app.purge_sign_in_record()') IS NULL
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): owner is ' || pg_get_userbyid(p.proowner) || ', not poly_purge'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.purge_sign_in_record()') AND pg_get_userbyid(p.proowner) <> 'poly_purge'
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): not SECURITY DEFINER'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.purge_sign_in_record()') AND NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): ' || r || ' can execute it'
  FROM logins WHERE to_regprocedure('app.purge_sign_in_record()') IS NOT NULL AND r <> 'poly_worker'
    AND has_function_privilege(r, to_regprocedure('app.purge_sign_in_record()'), 'EXECUTE')
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): poly_worker cannot execute it'
  WHERE to_regprocedure('app.purge_sign_in_record()') IS NOT NULL
    AND NOT has_function_privilege('poly_worker', to_regprocedure('app.purge_sign_in_record()'), 'EXECUTE')
  -- 5. no login role writes any of the tables (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; table or column level)
  UNION ALL
  SELECT 'FAIL ' || t || ': ' || r || ' holds ' || p
  FROM tbls CROSS JOIN logins CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'TRUNCATE', 'TRIGGER']) p
  WHERE to_regclass(t) IS NOT NULL
    AND CASE WHEN p IN ('INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege(r, to_regclass(t), p)
             ELSE has_table_privilege(r, to_regclass(t), p) END
  -- 6. no runtime role reads the sign-in record (poly_backup is the one reader)
  UNION ALL
  SELECT 'FAIL app.sign_in_record: ' || r || ' can read it'
  FROM runtime WHERE to_regclass('app.sign_in_record') IS NOT NULL
    AND has_any_column_privilege(r, to_regclass('app.sign_in_record'), 'SELECT')
  -- 7. the asserted-user entry is gone
  UNION ALL
  SELECT 'FAIL function ' || p.oid::regprocedure::text || ': exists'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'enter_asserted_user'
  -- 8. poly_app holds nothing on the six BetterAuth tables, the handle table, the record or the streak
  UNION ALL
  SELECT 'FAIL ' || t || ': poly_app holds ' || p
  FROM (SELECT t FROM betterauth UNION ALL SELECT 'app.session_handle' UNION ALL SELECT 'app.sign_in_record'
        UNION ALL SELECT 'app.second_step_streak') x(t)
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'TRUNCATE', 'TRIGGER']) p
  WHERE to_regclass(t) IS NOT NULL
    AND CASE WHEN p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege('poly_app', to_regclass(t), p)
             ELSE has_table_privilege('poly_app', to_regclass(t), p) END
  UNION ALL
  SELECT 'FAIL ' || t || ': missing' FROM (SELECT t FROM betterauth UNION ALL SELECT 'app.session_handle') x(t) WHERE to_regclass(t) IS NULL
  -- 9. poly_app's EXECUTE set on app is exactly the eleven
  UNION ALL
  SELECT 'FAIL function ' || p.oid::regprocedure::text || ': poly_app can execute it'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND has_function_privilege('poly_app', p.oid, 'EXECUTE')
    AND p.oid::regprocedure::text NOT IN (SELECT sig FROM app_eleven)
  UNION ALL
  SELECT 'FAIL function ' || sig || ': poly_app cannot execute it (or it is missing)'
  FROM app_eleven WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege('poly_app', to_regprocedure(sig), 'EXECUTE')
  -- 11. role membership is the exact set: a login role that can SET ROLE to a definer owner passes every line above
  UNION ALL
  SELECT 'FAIL membership: ' || m || ' holds ' || r || ' (inherit ' || coalesce(inh::text, '-') || ', set ' || coalesce(st::text, '-')
         || ', admin ' || adm || ') and should not, or not so'
  FROM (SELECT * FROM member_have EXCEPT SELECT * FROM member_want) x
  UNION ALL
  SELECT 'FAIL membership: ' || m || ' does not hold ' || r || ' as it should'
  FROM (SELECT * FROM member_want EXCEPT SELECT * FROM member_have) x
  -- 12. method changes are audited by the database: the sync triggers run app.sync_second_step(), whose body writes both kinds
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': does not run app.sync_second_step()'
  FROM sync_trig JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE g.tgfoid IS DISTINCT FROM to_regprocedure('app.sync_second_step()')
  UNION ALL
  SELECT 'FAIL function app.sync_second_step(): its body does not write ' || k
  FROM unnest(ARRAY['second_step.method_added', 'second_step.method_removed']) k
  WHERE to_regprocedure('app.sync_second_step()') IS NOT NULL
    AND position(k IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('app.sync_second_step()'))) = 0
  -- 12b. the no-truncate triggers are BEFORE TRUNCATE, statement-level (tgtype 34 = BEFORE 2 + TRUNCATE 32, no row bit) and run app.refuse_truncate()
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': not BEFORE TRUNCATE FOR EACH STATEMENT running app.refuse_truncate()'
  FROM (VALUES ('public.two_factor', 'two_factor_no_truncate'), ('public.passkey', 'passkey_no_truncate')) t(tbl, name)
  JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE g.tgtype <> 34 OR g.tgfoid IS DISTINCT FROM to_regprocedure('app.refuse_truncate()')
  -- 13. complete_step_up: owner poly_govern, SECURITY DEFINER, EXECUTE poly_auth only; no login role writes recent_auth_at itself
  UNION ALL
  SELECT 'FAIL function app.complete_step_up(text,uuid,bigint): missing' WHERE to_regprocedure('app.complete_step_up(text,uuid,bigint)') IS NULL
  UNION ALL
  SELECT 'FAIL function app.complete_step_up(text,uuid,bigint): owner is ' || pg_get_userbyid(p.proowner) || ', not poly_govern'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.complete_step_up(text,uuid,bigint)') AND pg_get_userbyid(p.proowner) <> 'poly_govern'
  UNION ALL
  SELECT 'FAIL function app.complete_step_up(text,uuid,bigint): not SECURITY DEFINER'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.complete_step_up(text,uuid,bigint)') AND NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function app.complete_step_up(text,uuid,bigint): ' || r || ' can execute it'
  FROM logins WHERE to_regprocedure('app.complete_step_up(text,uuid,bigint)') IS NOT NULL AND r <> 'poly_auth'
    AND has_function_privilege(r, to_regprocedure('app.complete_step_up(text,uuid,bigint)'), 'EXECUTE')
  UNION ALL
  SELECT 'FAIL function app.complete_step_up(text,uuid,bigint): poly_auth cannot execute it'
  WHERE to_regprocedure('app.complete_step_up(text,uuid,bigint)') IS NOT NULL
    AND NOT has_function_privilege('poly_auth', to_regprocedure('app.complete_step_up(text,uuid,bigint)'), 'EXECUTE')
  UNION ALL
  SELECT 'FAIL public.session.recent_auth_at: ' || r || ' holds UPDATE' FROM logins
  WHERE has_column_privilege(r, 'public.session', 'recent_auth_at', 'UPDATE')
  -- 14. the step-up trigger on the pending row is a deferred constraint trigger (raises at commit, not at the statement)
  UNION ALL
  SELECT 'FAIL trigger step_up_pending_resolved on app.step_up_pending: not DEFERRABLE INITIALLY DEFERRED'
  FROM pg_trigger g WHERE g.tgrelid = to_regclass('app.step_up_pending') AND g.tgname = 'step_up_pending_resolved'
    AND NOT g.tgisinternal AND NOT (g.tgdeferrable AND g.tginitdeferred)
  -- 10. no login role can delete a user
  UNION ALL
  SELECT 'FAIL public."user": ' || r || ' holds DELETE' FROM logins WHERE has_table_privilege(r, 'public."user"', 'DELETE')
  -- 15. (POLY-137) the hold and the outbox: lines 1 and 5 cover their existence, row-level security and every write privilege; no runtime role reads either
  UNION ALL
  SELECT 'FAIL ' || t || ': ' || r || ' holds SELECT'
  FROM tbls_read CROSS JOIN runtime WHERE to_regclass(t) IS NOT NULL AND has_any_column_privilege(r, to_regclass(t), 'SELECT')
  -- 16. and 20. the guards run the right function, and the two method-hold triggers are BEFORE UPDATE OF the named columns
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': does not run ' || fn
  FROM trig_fn JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE g.tgfoid IS DISTINCT FROM to_regprocedure(fn)
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': not ' || frag
  FROM trig_def JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE position(frag IN pg_get_triggerdef(g.oid)) = 0
  -- 17. the bodies name the hold and the outbox (a tripwire, see body_chk)
  UNION ALL
  SELECT 'FAIL function ' || sig || ': its body does not mention ' || needle
  FROM body_chk WHERE to_regprocedure(sig) IS NOT NULL
    AND position(needle IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(sig))) = 0
  -- 18. the nine definers: owner, SECURITY DEFINER, executable by exactly the listed login role
  UNION ALL
  SELECT 'FAIL function ' || sig || ': missing' FROM def137 WHERE to_regprocedure(sig) IS NULL
  UNION ALL
  SELECT 'FAIL function ' || sig || ': owner is ' || pg_get_userbyid(p.proowner) || ', not ' || owner
  FROM def137 JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE pg_get_userbyid(p.proowner) <> owner
  UNION ALL
  SELECT 'FAIL function ' || sig || ': not SECURITY DEFINER'
  FROM def137 JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function ' || sig || ': ' || r || ' can execute it'
  FROM def137 CROSS JOIN logins WHERE to_regprocedure(sig) IS NOT NULL AND r IS DISTINCT FROM exec
    AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')
  UNION ALL
  SELECT 'FAIL function ' || sig || ': ' || exec || ' cannot execute it'
  FROM def137 WHERE exec IS NOT NULL AND to_regprocedure(sig) IS NOT NULL AND NOT has_function_privilege(exec, to_regprocedure(sig), 'EXECUTE')
  -- 19. no notice has waited over an hour. The gate runs at INFRA 7.1 step 16 and when the operator reruns it: this is not a standing monitor.
  -- The standing control is the hold itself: an unsent notice keeps its method off (an undeliverable notice is a runbook case).
  UNION ALL
  SELECT 'FAIL mail: ' || n || ' notices unsent for over an hour' FROM cnt WHERE k = 'mail_unsent' AND n > 0
  -- 21. poly_auth's idle-in-transaction timeout (roles.sql)
  UNION ALL
  SELECT 'FAIL role poly_auth: idle_in_transaction_session_timeout is not 15s'
  WHERE NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                    WHERE r.rolname = 'poly_auth' AND s.setdatabase = 0 AND 'idle_in_transaction_session_timeout=15s' = ANY (s.setconfig))
  -- 22-24. a missed purge shows as rows past their purge age
  UNION ALL
  SELECT 'FAIL purge: app.tx_identity holds ' || 'rows older than 6 hours' FROM cnt WHERE k = 'tx_identity' AND n > 0
  UNION ALL
  SELECT 'FAIL purge: app.sign_in_record holds ' || 'rows older than 401 days' FROM cnt WHERE k = 'sign_in_record' AND n > 0
  UNION ALL
  SELECT 'FAIL purge: app.mail_outbox holds ' || 'sent rows older than 31 days' FROM cnt WHERE k = 'mail_sent_old' AND n > 0
)
SELECT line FROM f
UNION ALL SELECT 'gate: pass' WHERE NOT EXISTS (SELECT 1 FROM f);
