// Board presentation logic — pure and unit-tested. Grouping itself comes from
// @pipeline/contracts (boardFromApplications on the server); the phone only
// filters what the server grouped.
import type { Board, CompanyGroup, Status } from "@pipeline/contracts";

/** Case-insensitive company/role search over the server-grouped board. A group
 *  survives if its company matches (all positions shown) or any position's role
 *  matches (only matching positions shown). */
export function filterBoard(groups: CompanyGroup[], query: string): CompanyGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: CompanyGroup[] = [];
  for (const g of groups) {
    if (g.company.toLowerCase().includes(q)) {
      out.push(g);
      continue;
    }
    const roles = g.applications.filter((a) => a.role.toLowerCase().includes(q));
    if (roles.length) out.push({ ...g, applications: roles });
  }
  return out;
}

/** Status filter on top of search (tapping a count chip). */
export function filterByStatus(groups: CompanyGroup[], status: Status | null): CompanyGroup[] {
  if (!status) return groups;
  const out: CompanyGroup[] = [];
  for (const g of groups) {
    const matches = g.applications.filter((a) => a.status === status);
    if (matches.length) out.push({ ...g, applications: matches });
  }
  return out;
}

/** The count chips in board order, non-zero first, total last. */
export function countChips(counts: Board["counts"]): { status: Status; count: number }[] {
  const order: Status[] = ["applied", "interview", "offer", "rejected", "cancelled"];
  return order.map((status) => ({ status, count: counts[status] })).filter((c) => c.count > 0);
}
