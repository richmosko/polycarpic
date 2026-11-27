// POLY-96 ruling Addendum 1, A1 (apt trust: the base's own signed sources, upgrade only).
// Read by tests/image/apt-and-pm.test.ts (the root Dockerfile) and shipped-apt.test.ts (every shipped Dockerfile).

/** Check one RUN-ish line against the A1 rules. Returns the violations. */
export function aptViolations(line: string): string[] {
  const v: string[] = [];
  if (/--allow-unauthenticated|--allow-insecure-repositories|--allow-downgrades|--allow-remove-essential|--allow-change-held-packages/.test(line)) v.push('allow-* flag');
  if (/\[[^\]]*trusted\s*=\s*yes[^\]]*\]/i.test(line)) v.push('trusted=yes');
  if (/Acquire::|APT::Get::/i.test(line)) v.push('Acquire::/APT::Get:: option');
  if (/apt-key|add-apt-repository|signed-by|sources\.list|\/etc\/apt\/(sources|trusted|keyrings)/.test(line)) v.push('added source or key');
  for (const m of line.matchAll(/\bapt(?:-get)?\b((?:\s+-\S+)*)\s+([a-z-]+)/g)) {
    if (!['update', 'upgrade'].includes(m[2]!)) v.push(`apt ${m[2]} (only update and upgrade are ruled)`);
  }
  return v;
}
