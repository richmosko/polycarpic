"""POLY-97 R8: laptop-check.py fails if hcloud holds any context, HCLOUD_TOKEN is set, or hcloud's config file holds a token.
Contract pins: runner(argv, env) -> (returncode, stdout) runs `hcloud context list`; the config file is $HCLOUD_CONFIG, else <home>/.config/hcloud/cli.toml."""
import unittest
from pathlib import Path

from base import ToolTest

HEADER = "ACTIVE   NAME\n"
TOKEN = "hcloudtoken-cccccccccccccccccccccccccccccccccccc"


class LaptopCheck(ToolTest):
    def go(self, listing=HEADER, env=None, config=None, rc_list=0):
        calls = []

        def runner(argv, env=None, stdin=None):
            calls.append(list(argv))
            return rc_list, listing

        if config is not None:
            p = self.tmp / ".config" / "hcloud"
            p.mkdir(parents=True, exist_ok=True)
            (p / "cli.toml").write_text(config)
        self.calls = calls
        return self.tool("laptop-check", [], None, runner=runner, env_extra=env)

    def test_a_clean_laptop_passes_and_asks_hcloud_for_its_contexts(self):
        rc, out, err = self.go()
        self.assertEqual(rc, 0, out + err)
        self.assertIn(["hcloud", "context", "list"], self.calls)
        self.assertEqual(self.lines(out)[-1], "LAPTOP CHECK PASSED")

    def test_a_planted_hcloud_context_fails_and_names_it(self):
        rc, out, _ = self.go(listing="ACTIVE   NAME\n*        polycarpic\n")
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", "polycarpic")
        self.assertNotIn("LAPTOP CHECK PASSED", out)

    def test_hcloud_token_in_the_environment_fails_naming_the_variable_and_never_printing_it(self):
        rc, out, err = self.go(env={"HCLOUD_TOKEN": TOKEN})
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", "HCLOUD_TOKEN")
        self.assertNotIn(TOKEN, out + err)

    def test_a_token_in_hclouds_config_file_fails_without_printing_it(self):
        rc, out, err = self.go(config='[[contexts]]\nname = "x"\ntoken = "%s"\n' % TOKEN)
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", "cli.toml")
        self.assertNotIn(TOKEN, out + err)

    def test_a_config_file_without_a_token_is_fine(self):
        rc, out, _ = self.go(config='active_context = ""\n[preferences]\ndebug = false\n')
        self.assertEqual(rc, 0, out)

    def test_an_hcloud_config_pointed_at_by_the_environment_is_read_instead(self):
        other = self.tmp / "elsewhere.toml"
        other.write_text('token = "%s"\n' % TOKEN)
        rc, out, err = self.go(env={"HCLOUD_CONFIG": str(other)})
        self.assertEqual(rc, 1)
        self.assertNotIn(TOKEN, out + err)

    def test_an_hcloud_that_errors_fails_closed(self):
        rc, out, _ = self.go(rc_list=1, listing="")
        self.assertEqual(rc, 1)
        self.assertNotIn("LAPTOP CHECK PASSED", out)


if __name__ == "__main__":
    unittest.main()
