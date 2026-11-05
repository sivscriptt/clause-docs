import type { Role } from "./lifecycle/machine";

export type Actor = { id: string; name: string; roles: Role[] };

/**
 * Where the signed-in user comes from. Production uses OIDC (the bank's
 * identity provider maps groups to roles); the public demo uses a role
 * switcher so anyone can try every role without an account.
 */
export interface AuthProvider {
  currentUserId(): Promise<string | null>;
}

export const DEMO_COOKIE = "demo_user";
export const DEFAULT_DEMO_USER = "aisha";

export const can = {
  edit: (a: Actor) => a.roles.includes("author") || a.roles.includes("admin"),
  comment: (a: Actor) => a.roles.some((r) => r !== "reader"),
  seeDrafts: (a: Actor) => a.roles.some((r) => r !== "reader"),
  readAudit: (a: Actor) => a.roles.some((r) => r === "admin" || r === "approver" || r === "reviewer"),
};
