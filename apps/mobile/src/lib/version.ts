// Semver-ish comparison for the /api/meta forced-upgrade gate. Handles plain
// dotted numerics ("1.2.3"); anything unparseable compares as 0 so a malformed
// server value can never lock users out.
export function versionAtLeast(current: string, minimum: string): boolean {
  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const c = parse(current);
  const m = parse(minimum);
  for (let i = 0; i < Math.max(c.length, m.length); i++) {
    const a = c[i] ?? 0;
    const b = m[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
