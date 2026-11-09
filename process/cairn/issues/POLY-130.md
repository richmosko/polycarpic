---
id: POLY-130
title: Secrets seam: seal, open, opener
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-82]
assignee: backend-lead
paths: [packages/secrets/**]
labels: [security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

packages/secrets per SECURITY §6.3 and C-30: HPKE (X25519 / HKDF-SHA256 / AES-256-GCM), built with SecEng sign-off (ARCH §2.2). seal() is on the index, and web uses it. open() and the opener factory are on the `./open` subpath, which apps/worker alone may import (ARCH §2.1 layer map). The opener the worker hands to `ingest` is bound to one connection's AAD, so an adapter bug cannot open another connection's credential (SECURITY A-39). Key rotation (§6.4) is not in this issue. Gap filed 2026-11-09 from seceng's review of ARCH v1.12: no issue built the package.

## Acceptance criteria

- [ ] seal() and open() round-trip. A swapped AAD (connection, entity, provider, key_id, alg_version), tampered ciphertext or an unknown key_id each fails closed (C-30).
- [ ] `secrets/open` exports a factory that returns an `Opener` bound to one connection. An opener built for connection A refuses connection B's sealed blob (SECURITY A-39).
- [ ] `Opener` is exported from the `@poly/secrets` index as a type only. A type test shows the index exports neither `open` nor a runtime opener.
- [ ] A module-graph check shows the `@poly/secrets` index graph includes neither the open module nor the keyring reader. A fixture that imports the open module from the index fails the check (SECURITY A-39).
- [ ] The keyring is read only from the mounted keyring file. With no file, open() and the opener factory fail closed with a named error, and seal() still works from the public keys.
