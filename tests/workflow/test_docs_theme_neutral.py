"""The docs (PRD / ARCH / SECURITY / DESIGN) use a neutral theme of their own and
must never read the product design tokens, so a product palette or font change
cannot restyle the documentation.

Guards on docs/_assets/{doc.css, comments.css, mermaid-init.js}:
  * no `tokens.css` import or link;
  * no `var(--<name>)` where <name> is any custom property that
    docs/DESIGN/tokens.css defines (read live, so new tokens are covered);
  * doc.css defines the --doc-* palette in light and dark with AA contrast
    for text on the card and on the tinted fills.
"""
from __future__ import annotations

import re
import unittest

import workflow_helpers

ASSETS = workflow_helpers.REPO_ROOT / "docs" / "_assets"
TOKENS = workflow_helpers.REPO_ROOT / "docs" / "DESIGN" / "tokens.css"
GUARDED = ("doc.css", "comments.css", "mermaid-init.js")


def product_tokens() -> set[str]:
    names = set(re.findall(r"^\s*(--[a-z0-9-]+)\s*:", TOKENS.read_text(), re.M))
    if not names:
        raise AssertionError(f"no custom properties found in {TOKENS}")
    return names


def luminance(hex_color: str) -> float:
    def lin(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def palette(block: str) -> dict[str, str]:
    return dict(re.findall(r"(--doc-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b", block))


class DocsThemeNeutralTests(unittest.TestCase):
    def test_no_tokens_css_reference(self):
        for name in GUARDED:
            text = (ASSETS / name).read_text()
            self.assertNotRegex(text, r"""(@import|href=|src=|url\()[^;\n]*tokens\.css""", name)

    def test_no_product_token_var_references(self):
        tokens = product_tokens()
        for name in GUARDED:
            used = set(re.findall(r"var\(\s*(--[a-z0-9-]+)", (ASSETS / name).read_text()))
            leaked = sorted(used & tokens)
            self.assertEqual(leaked, [], f"{name} reads product tokens {leaked}")

    def test_doc_names_do_not_collide_with_product_tokens(self):
        defined = set(re.findall(r"^\s*(--[a-z0-9-]+)\s*:", (ASSETS / "doc.css").read_text(), re.M))
        self.assertEqual(sorted(defined & product_tokens()), [])

    def test_palette_contrast_light_and_dark(self):
        css = (ASSETS / "doc.css").read_text()
        light = palette(css[css.index(":root {") : css.index("@media (prefers-color-scheme: dark)")])
        dark = palette(css[css.index(":root.dark {") :])
        for mode, p in (("light", light), ("dark", dark)):
            for fg, bg in (
                ("--doc-fg", "--doc-card"),
                ("--doc-muted", "--doc-card"),
                ("--doc-accent", "--doc-card"),
                ("--doc-fg", "--doc-accent-bg"),
                ("--doc-muted", "--doc-accent-bg"),
                ("--doc-accent", "--doc-accent-bg"),
                ("--doc-fg", "--doc-code-bg"),
            ):
                ratio = contrast(p[fg], p[bg])
                self.assertGreaterEqual(ratio, 4.5, f"{mode}: {fg} on {bg} = {ratio:.2f}")

    def test_dark_blocks_agree(self):
        """The OS-dark media block and the explicit .dark block carry the same palette."""
        css = (ASSETS / "doc.css").read_text()
        media = css[css.index("@media (prefers-color-scheme: dark)") : css.index(":root.dark {")]
        explicit = css[css.index(":root.dark {") :]
        self.assertEqual(palette(media), palette(explicit.split("}")[0]))


if __name__ == "__main__":
    unittest.main()
