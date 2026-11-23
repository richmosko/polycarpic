"""S3/D3: the guard's policy is the installed one. A release that managed to put its own wider `compose-allow.json` next to its compose files (here: written at render time, in the
release directory's infra/deploy) changes nothing: the guard reads the ops bundle's copy only."""
import json
import os

from base import REPO
import test_deploy_guard as g
from test_deploy_guard import both, svc


class PolicyIsInstalled(g.Guard):
    def test_a_wider_policy_inside_the_release_directory_is_never_read(self):
        wide = json.loads((REPO / "infra" / "deploy" / "compose-allow.json").read_text())
        wide["projects"]["staging"]["services"]["web"]["keys"] = sorted(set(wide["projects"]["staging"]["services"]["web"]["keys"]) | {"privileged"})

        def plant(cmd, argv):
            if cmd == "config" and "--project-directory" in argv:
                cdir = argv[argv.index("--project-directory") + 1]
                dest = os.path.join(os.path.dirname(os.path.dirname(cdir)), "infra", "deploy", "compose-allow.json")
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "w") as fh:
                    json.dump(wide, fh)
        self.candidate(both(svc("web", privileged=True)))
        self.world.on_compose = plant
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused guard-key"), r.err)
        self.assertEqual(self.started(r), [])

    def test_a_wider_policy_inside_currents_release_directory_is_never_read(self):
        # `current`'s release directory exists before the run, so the file is there before the guard reads anything; `current`'s own render is the unsafe one
        wide = json.loads((REPO / "infra" / "deploy" / "compose-allow.json").read_text())
        wide["projects"]["staging"]["services"]["web"]["keys"] = sorted(set(wide["projects"]["staging"]["services"]["web"]["keys"]) | {"privileged"})
        cur = "sha256-" + self.current_digest.split(":")[1]
        dest = self.host.p("/opt/polycarpic/releases/%s/infra/deploy/compose-allow.json" % cur)
        os.makedirs(os.path.dirname(str(dest)), exist_ok=True)
        dest.write_text(json.dumps(wide))
        self.candidate({})
        self.world.dir_hooks[cur] = lambda d: d["services"]["web"].update(privileged=True) or d
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused guard-key"), r.err)
        self.assertEqual(self.started(r), [])

    # the inherited T8 cases are test_deploy_guard.py's; not repeated here
    test_t8_each_unsafe_render_is_refused_before_any_candidate_container = None
    test_t8_positive_the_real_bundle_passes_the_guard = None
    test_t8_a_permissive_policy_inside_the_bundle_is_ignored = None
