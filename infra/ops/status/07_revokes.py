"""status item revokes: plpgsql and the 17 built-ins are closed to PUBLIC (R7a; POLY-147 R10, R11; SECURITY C-87; K10).

The signatures come from the installed roles.sql, are matched against a strict pattern, and are passed as quoted literals.
The query prints nothing when all is closed, else `open:plpgsql`, `open:<sig>` and `missing:<sig>` lines.
"""
import re

from lib import compose, ts
from lib.out import Line, clean

PROJECTS = ("prod", "staging")
WANT = 17
REVOKE = re.compile(r"^REVOKE EXECUTE ON FUNCTION pg_catalog\.(\S+) FROM PUBLIC;$", re.M)
SIG = re.compile(r"^[a-z_]+\([a-z_, ]*\)$")

SQL = """SELECT 'open:plpgsql' WHERE EXISTS (SELECT 1 FROM pg_language l, LATERAL aclexplode(coalesce(l.lanacl, acldefault('l', l.lanowner))) a
  WHERE l.lanname = 'plpgsql' AND a.grantee = 0 AND a.privilege_type = 'USAGE');
SELECT CASE WHEN to_regprocedure('pg_catalog.' || s) IS NULL THEN 'missing:' || s ELSE 'open:' || s END
FROM unnest(ARRAY[%s]) AS s
WHERE to_regprocedure('pg_catalog.' || s) IS NULL
   OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = to_regprocedure('pg_catalog.' || s) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE');
"""


def _signatures(ctx):
    text = ts.read_text(ctx.bundle("packages/db/sql/roles.sql"))
    if text is None:
        return None, "roles.sql is not in the installed bundle"
    sigs = REVOKE.findall(text)
    if len(sigs) != WANT:
        return None, "roles.sql lists %d built-ins, want %d" % (len(sigs), WANT)
    if not all(SIG.match(s) for s in sigs):
        return None, "roles.sql holds a signature outside the allowed pattern"
    return sigs, None


def _one(ctx, project, sigs):
    if not compose.running(compose.ps(ctx, "polycarpic-" + project), "postgres"):
        return Line("WAIT", "revokes", project, "postgres is not running")
    code, text = ts.psql(ctx, project, SQL % ", ".join("'%s'" % s for s in sigs))
    if code != 0:
        return Line("RED", "revokes", project, "the revokes query failed")
    problems = []
    for row in text.split("\n"):
        row = row.strip()
        if row == "open:plpgsql":
            problems.append("plpgsql is open to PUBLIC")
        elif row.startswith("open:"):
            problems.append("%s is open" % clean(row[5:]))
        elif row.startswith("missing:"):
            problems.append("%s not found" % clean(row[8:]))
    if problems:
        return Line("RED", "revokes", project, "; ".join(problems))
    return Line("OK", "revokes", project, "plpgsql and %d built-ins closed to PUBLIC" % WANT)


def run(ctx):
    sigs, error = _signatures(ctx)
    if error:
        return [Line("RED", "revokes", p, error) for p in PROJECTS]
    return [_one(ctx, p, sigs) for p in PROJECTS]
