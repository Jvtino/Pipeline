// Board assembly for the API. The thread → derived-record reduction now lives in
// @pipeline/classify (shared with the sync engine); here we just compose it with
// the shared grouping helper. Re-exported so existing imports stay stable.
import { boardFromApplications, type Thread, type Board } from "@pipeline/contracts";
import { threadsToApplications } from "@pipeline/classify";

export { statusForThread, threadToApplication, threadsToApplications } from "@pipeline/classify";

/** Build the full board payload from raw threads (classify → derive → group). */
export function buildBoard(threads: Thread[], source: string): Board {
  return boardFromApplications(threadsToApplications(threads), source);
}
