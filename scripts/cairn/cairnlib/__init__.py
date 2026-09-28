"""cairnlib — cairn's implementation package.

Split out of cairn.py (POLY-58); see process/cairn/reviews/POLY-58/ruling.md for
the module boundaries and extraction order. `cairn.py` stays the CLI entry
and a re-export facade over this package, so `import cairn` is unchanged
for every existing caller. This file intentionally re-exports nothing.
"""
