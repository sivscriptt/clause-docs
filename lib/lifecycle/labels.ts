import type { State } from "./machine";

/** The one name for each state, used by badges, pickers and server messages alike. */
export const STATE_LABEL: Record<State, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  active: "Active",
  superseded: "Superseded",
  retired: "Retired",
};

export const stateLabel = (s: State) => STATE_LABEL[s];
