
# POLY-132: seceng section (S96-16, S96-20, A4, A5)

Reviewed `cb79dcb..d9be8c0`. Code change: two lines in `infra/ci/image.sh check` (`docker pull -q` when the ref contains `@sha256:`). There is no workflow change, and `tests/ci/build-main-only.test.ts` is new.

| axis | result | evidence |
|---|---|---|
| S96-16 attest only after scan, one digest | pass | build.yml unchanged: push → check → Trivy → SBOM → attest, all fed `steps.build.outputs.digest`; test "both attestations come after scan AND check" and "build step is the only source of the digest" @d9be8c0 |
| S96-20 no cache into the attested build | pass | the pull runs after build-push has finished and lands in the runner's local Docker store, not in buildx's builder cache; the build still has `no-cache: true` and `pull: true`, and no `cache-from` @d9be8c0 |
| A4 checked on the built image | pass | `check` now inspects and runs the exact pushed digest, where it used to fail with "No such image" (run 42955852310); `User` and the package-manager assertions are unchanged @d9be8c0 |
| A5 / no second subject | pass | pull by digest is content-addressed and creates no tag; nothing is pushed, re-tagged or re-resolved; attestation `subject-digest` is still the build output; test "check, scan and sbom are all given ${IMAGE}@${DIGEST}, never a tag" @d9be8c0 |

Observation, not new and not blocking: `image.sh check` runs `sh` inside the not-yet-scanned image, in the job that holds `packages: write` and `id-token: write`. The container gets no env from the step (`docker run` without `-e`), so it does not receive `ACTIONS_ID_TOKEN_REQUEST_*` or the token. The image is our own `main` build. This was already true at 5c5ffff; POLY-132 does not change it. If it ever matters, `--network none` on that `docker run` closes it at no cost. That would be a one-line follow-up for a later loop, not this one.

Verdict: **pass**. Nothing blocks.
