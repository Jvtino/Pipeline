// Company/contact monogram tints. A company's avatar is its first letter on a
// soft tinted square; the tint is hashed from the first character across this
// palette (from the design's Avatar-monograms spec), so the same company always
// gets the same color across screens.

export interface Tint {
  mbg: string;
  mfg: string;
}

export const PALETTE: Tint[] = [
  { mbg: "#e3ead0", mfg: "#4a5a2e" },
  { mbg: "#e6e0ef", mfg: "#4a3f6b" },
  { mbg: "#dfe7ea", mfg: "#2f4a55" },
  { mbg: "#efe0d2", mfg: "#7a4a24" },
  { mbg: "#e9dfe6", mfg: "#6b4a64" },
  { mbg: "#d9e4df", mfg: "#27564a" },
  { mbg: "#dfe3ea", mfg: "#3c4960" },
];

/** Deterministic tint for a name, hashed on its first character. */
export function tintFor(name: string): Tint {
  const code = name && name.length ? name.toUpperCase().charCodeAt(0) : 65;
  return PALETTE[code % PALETTE.length] as Tint;
}

/** First letter of a company, uppercased (falls back to "?"). */
export function monogram(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

/** Up to two initials for a person's name (e.g. "Sarah Chen" → "SC"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
