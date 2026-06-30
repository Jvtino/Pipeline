// The 7-status presentation system from the redesign. The API/classifier are
// frozen at 4 real statuses (applied | interview | offer | rejected); the other
// three (wishlist, screening, no_response) are presentation/overlay concepts:
//   - the user can set wishlist/screening manually (New App modal, Move stage),
//   - no_response is *derived* from a stale "applied" record (see lib/derive).
// Colors are the single source of truth — applied as inline styles, never
// duplicated in CSS. Deliberately muted (rejection red shouldn't feel like 911).
import type { Status as ApiStatus } from "@pipeline/contracts";

export type UiStatus = "wishlist" | "applied" | "screening" | "interview" | "offer" | "rejected" | "no_response";

export interface StatusStyle {
  label: string;
  dot: string;
  fg: string;
  bg: string;
}

export const STATUS: Record<UiStatus, StatusStyle> = {
  wishlist: { label: "Wishlist", dot: "#a99bc0", fg: "#6b5e86", bg: "rgba(169,155,192,.18)" },
  applied: { label: "Applied", dot: "#6c7d96", fg: "#54657d", bg: "rgba(108,125,150,.15)" },
  screening: { label: "Screening", dot: "#6f86b8", fg: "#4a5f8c", bg: "rgba(111,134,184,.16)" },
  interview: { label: "Interview", dot: "#c08a2a", fg: "#9a6a16", bg: "rgba(192,138,42,.16)" },
  offer: { label: "Offer", dot: "#2f9266", fg: "#1f7a52", bg: "rgba(47,146,102,.15)" },
  rejected: { label: "Rejected", dot: "#c06a57", fg: "#a85544", bg: "rgba(192,106,87,.15)" },
  no_response: { label: "No Response", dot: "#b0a48f", fg: "#857a64", bg: "rgba(176,164,143,.2)" },
};

/** Tab/segment order used by Applications filter tabs and the donut/funnel. */
export const STATUS_ORDER: UiStatus[] = ["wishlist", "applied", "screening", "interview", "offer", "rejected", "no_response"];

/** Statuses offered in the New Application modal (matches the prototype's 6). */
export const NEW_APP_STATUSES: UiStatus[] = ["wishlist", "applied", "screening", "interview", "offer", "rejected"];

/** Statuses offered by the drawer's "Move stage" row. */
export const MOVE_STAGES: UiStatus[] = ["wishlist", "applied", "screening", "interview", "offer", "rejected"];

/** A real API status is already a valid UiStatus — this just narrows the type. */
export function fromApiStatus(s: ApiStatus): UiStatus {
  return s;
}

export function styleFor(s: UiStatus): StatusStyle {
  return STATUS[s] ?? STATUS.applied;
}
