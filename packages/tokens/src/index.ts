// Pipeline design tokens — the desktop app's dark theme, transcribed from the
// `:root` block of index.html (lines 11-36), as zero-dependency constants any
// surface can import. The mobile app styles EXCLUSIVELY from here: if a value
// isn't a token, it isn't in the design.
//
// Deliberate divergences from CSS: colors that were alpha-composited over the
// page background in CSS (panel-2) are kept as rgba strings — React Native
// supports them natively; the radial-gradient page glow is described as data
// (see `glow`) because RN has no CSS gradients (render via expo-linear-gradient
// or a static asset).
import { STATUSES, type Status } from "@pipeline/contracts";

export const color = {
  bg: "#07090e",
  panel: "#0c111b",
  panel2: "rgba(16, 24, 38, 0.25)", // --panel-2 #10182640
  elev: "#0f1622",
  border: "rgba(255,255,255,0.07)",
  border2: "rgba(255,255,255,0.13)",

  text: "#e8edf5",
  textDim: "#9aa6b8",
  textFaint: "#61708a",

  blue: "#2f81f7",
  blue2: "#4f9cff",
  blueDeep: "#163a86",

  selection: "rgba(47,129,247,0.35)",
  white: "#ffffff",
} as const;

/** Status colors, keyed off the contracts STATUSES tuple so a status added to
 *  the classifier without a color is a compile error here — not a gray dot in
 *  production. Same values as the desktop theme's --c-* variables. */
export const statusColor: Record<Status, string> = {
  applied: "#8b97a8", // gray   — active / pending
  interview: "#f5c542", // yellow — meeting / interview
  offer: "#34d399", // green  — offer / accepted
  rejected: "#f0556b", // red    — rejected
  cancelled: "#f59e42", // orange — position cancelled
};

/** Human labels for statuses (title-case of the enum, centralized). */
export const statusLabel: Record<Status, string> = {
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export { STATUSES };

/** The page-background glow from the desktop theme, as data: two radial washes
 *  of the brand blue over `color.bg`. */
export const glow = {
  primary: { color: "rgba(47,129,247,0.16)", cx: 0.5, cy: -0.12, rx: 1100, ry: 560 },
  secondary: { color: "rgba(47,129,247,0.06)", cx: 0.92, cy: 0.08, rx: 800, ry: 500 },
} as const;

/** Corner radius — one size fits the whole desktop design. */
export const radius = { md: 16, sm: 10, pill: 999 } as const;

/** Spacing scale used throughout the desktop CSS (4/8/12/16/22 + the 32 hero gap). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 32 } as const;

/** Type scale: the desktop body is 15px/1.5; tiers mirror its dim/faint text. */
export const font = {
  size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, hero: 26 },
  lineHeight: 1.5,
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
} as const;

export const shadow = {
  // --shadow: 0 10px 30px rgba(0,0,0,.45) → RN shadow props + Android elevation
  card: { shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 30, elevation: 12 },
} as const;
