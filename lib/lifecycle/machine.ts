/**
 * Document lifecycle. Every state change in the system goes through `decide`,
 * so the UI (which buttons are enabled), the API and the database transaction
 * all use the same rules.
 */
import { stateLabel } from "./labels";

export const STATES = [
  "draft",
  "in_review",
  "changes_requested",
  "pending_approval",
  "approved",
  "active",
  "superseded",
  "retired",
] as const;
export type State = (typeof STATES)[number];

export const ROLES = ["author", "reviewer", "approver", "reader", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "submit"
  | "request_changes"
  | "send_for_approval"
  | "reject"
  | "approve"
  | "activate"
  | "withdraw"
  | "retire";

type Rule = { from: readonly State[]; to: State; roles: readonly Role[]; label: string };

export const RULES: Record<Action, Rule> = {
  submit: { from: ["draft", "changes_requested"], to: "in_review", roles: ["author"], label: "Submit for review" },
  request_changes: { from: ["in_review"], to: "changes_requested", roles: ["reviewer"], label: "Request changes" },
  send_for_approval: { from: ["in_review"], to: "pending_approval", roles: ["reviewer"], label: "Send for approval" },
  reject: { from: ["pending_approval"], to: "changes_requested", roles: ["approver"], label: "Reject" },
  approve: { from: ["pending_approval"], to: "approved", roles: ["approver"], label: "Approve" },
  activate: { from: ["approved"], to: "active", roles: ["approver", "admin"], label: "Make active" },
  withdraw: { from: ["draft", "changes_requested"], to: "retired", roles: ["author", "admin"], label: "Withdraw" },
  retire: { from: ["active"], to: "retired", roles: ["admin"], label: "Retire" },
};

export const ACTIONS = Object.keys(RULES) as Action[];

export type DecisionInput = {
  action: Action;
  state: State;
  actor: { id: string; roles: readonly Role[] };
  authorId: string;
  openCriticalComments: number;
  metadataErrors: readonly string[];
};

export type Decision =
  | { ok: true; to: State; supersedes: boolean }
  | { ok: false; code: DenyCode; reason: string };

export type DenyCode =
  | "bad_state"
  | "forbidden_role"
  | "own_document"
  | "critical_comments_open"
  | "invalid_metadata";

const deny = (code: DenyCode, reason: string): Decision => ({ ok: false, code, reason });

export function decide(i: DecisionInput): Decision {
  const rule = RULES[i.action];
  if (!rule.from.includes(i.state)) {
    return deny("bad_state", `Can't ${rule.label.toLowerCase()} a version that is ${stateLabel(i.state).toLowerCase()}.`);
  }
  if (!rule.roles.some((r) => i.actor.roles.includes(r))) {
    return deny("forbidden_role", `Only ${rule.roles.join(" or ")} can do this.`);
  }
  // Separation of duties: nobody reviews or approves their own text.
  const judging = ["request_changes", "send_for_approval", "reject", "approve"].includes(i.action);
  if (judging && i.actor.id === i.authorId) {
    return deny("own_document", "You wrote this version, so someone else has to review or approve it.");
  }
  if ((i.action === "submit" || i.action === "activate") && i.metadataErrors.length) {
    return deny("invalid_metadata", `Fix the document details first: ${i.metadataErrors.join("; ")}.`);
  }
  if ((i.action === "send_for_approval" || i.action === "approve") && i.openCriticalComments > 0) {
    const n = i.openCriticalComments;
    return deny("critical_comments_open", `${n} critical comment${n === 1 ? " is" : "s are"} still open.`);
  }
  return { ok: true, to: rule.to, supersedes: i.action === "activate" };
}

/** Actions the UI should offer for a state, whether or not this actor may take them. */
export const actionsFrom = (s: State) => ACTIONS.filter((a) => RULES[a].from.includes(s));
