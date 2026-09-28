# POLY-58 gate-1 measurement: `python3 graph.py <cairn.py @ 55fd4b2> [edges|all|owner|size]`.
# Maps every top-level statement of the pre-split cairn.py to its ruled module by line range
# (later ranges override earlier ones) and reports cross-module name loads; "BACK" = a call
# from an earlier module into a later one, i.e. a violation of leaves-first. Valid only
# against the pre-split file.
import ast, sys, collections
src = open(sys.argv[1]).read()
tree = ast.parse(src)
ORDER = ['constants','errors','yamlsub','records','config','store','guards','lint','snapshot',
         'roster','attribution','flow','tokens','actuals','payloads','multiroot','watch','server',
         'archive','estimate','cli']
# (lo, hi_exclusive, module); later entries override earlier ones
R = [(1,271,'constants'),(271,336,'errors'),(336,528,'yamlsub'),(528,914,'records'),(914,1179,'config'),
     (1179,1532,'store'),(1532,2132,'lint'),(2132,2402,'snapshot'),(2402,2967,'attribution'),
     (2967,3539,'flow'),(3539,3636,'roster'),(3636,4005,'tokens'),(4005,4182,'actuals'),
     (4182,4589,'payloads'),(4589,4886,'multiroot'),(4886,5117,'watch'),(5117,5823,'server'),
     (5823,6343,'cli'),(6343,6502,'archive'),(6502,6790,'cli'),(6790,7274,'guards'),
     (7274,8000,'estimate'),(7983,8000,'cli'),
     # relocations
     (5827,5847,'config'),      # resolve_data_dir
     (5997,6018,'store'),       # _record_schema_for_path (+ its constant)
     (3570,3595,'store'),       # _repo_root_for
     (2136,2163,'store'),       # _id_sort_key
     (2163,2230,'lint'),        # _rotate_cycle_to_canonical, _detect_blocked_by_cycles
     (7281,7284,'constants'),   # _STAGE_ORDER
     (6297,6343,'archive'),     # _git_mv_or_rename
     (6502,6579,'archive'),     # cmd_archive
     (6943,6962,'guards'),
     (7545,7983,'estimate'),
     (2895,2967,'payloads'),    # build_dashboard_payload
     (7983,7987,'estimate'),    # _default_transcripts_dir
    ]
extra = sys.argv[3:] if len(sys.argv) > 3 else []
for e in extra:
    lo,hi,m = e.split(':'); R.append((int(lo),int(hi),m))
def mod(line):
    r=None
    for lo,hi,m in R:
        if lo<=line<hi: r=m
    return r
owner={}; nodes=[]; loc=collections.Counter()
for n in tree.body:
    names=[]
    if isinstance(n,(ast.FunctionDef,ast.ClassDef)): names=[n.name]
    elif isinstance(n,ast.Assign):
        for t in n.targets:
            for x in ast.walk(t):
                if isinstance(x,ast.Name): names.append(x.id)
    elif isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name): names=[n.target.id]
    for nm in names: owner.setdefault(nm, mod(n.lineno))
    nodes.append((n,names))
    loc[mod(n.lineno)] += (n.end_lineno - n.lineno + 1)
mode = sys.argv[2] if len(sys.argv)>2 else 'edges'
if mode=='owner':
    for k,v in sorted(owner.items(), key=lambda kv:(ORDER.index(kv[1]),kv[0])): print(v,k)
    sys.exit()
if mode=='size':
    c=collections.Counter(owner.values())
    for m in ORDER: print(f"{m:12s} defs={c[m]:3d} stmt_lines={loc[m]}")
    sys.exit()
edges=collections.defaultdict(set)
for n,names in nodes:
    m=mod(n.lineno)
    for x in ast.walk(n):
        if isinstance(x,ast.Name) and x.id in owner and owner[x.id]!=m:
            edges[(m,owner[x.id])].add(f"{names[0] if names else '?'}@{n.lineno}->{x.id}")
nback=0
for (a,b),ex in sorted(edges.items(), key=lambda k:(ORDER.index(k[0][0]),ORDER.index(k[0][1]))):
    back = ORDER.index(b)>ORDER.index(a)
    nback += back
    if back or mode=='all':
        print(("BACK " if back else "     ")+f"{a} -> {b} ({len(ex)}): "+"; ".join(sorted(ex)[:8]))
print("back-edges:", nback)
