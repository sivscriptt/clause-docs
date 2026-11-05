import { describe, expect, it } from "vitest";
import { ACTIONS, actionsFrom, decide, ROLES, RULES, STATES, type Action, type Role, type State } from "@/lib/lifecycle/machine";
import { formatVersion, nextVersion } from "@/lib/lifecycle/version";
import { metadataErrors } from "@/lib/doc/metadata";

const base = { authorId: "author-1", openCriticalComments: 0, metadataErrors: [] as string[] };
const run = (action: Action, state: State, role: Role, over: Partial<typeof base> & { actorId?: string } = {}) =>
  decide({ action, state, actor: { id: over.actorId ?? `${role}-9`, roles: [role] }, ...base, ...over });

describe("lifecycle transitions: the full matrix", () => {
  // Every action x every state x every role. Allowed exactly when the state and role match the rule.
  for (const action of ACTIONS) {
    for (const state of STATES) {
      for (const role of ROLES) {
        const rule = RULES[action];
        const allowed = rule.from.includes(state) && rule.roles.includes(role);
        it(`${role} ${action} from ${state} -> ${allowed ? rule.to : "denied"}`, () => {
          const d = run(action, state, role);
          if (allowed) expect(d).toEqual({ ok: true, to: rule.to, supersedes: action === "activate" });
          else expect(d.ok).toBe(false);
        });
      }
    }
  }

  it("checks state before role", () => {
    expect(run("approve", "draft", "reader")).toMatchObject({ ok: false, code: "bad_state" });
    expect(run("approve", "pending_approval", "reader")).toMatchObject({ ok: false, code: "forbidden_role" });
  });

  it("explains a wrong state in words", () => {
    expect(run("approve", "in_review", "approver")).toMatchObject({ reason: "Can't approve a version that is in review." });
  });

  it("only activate supersedes the previous active version", () => {
    const supers = ACTIONS.filter((a) => {
      const r = RULES[a];
      const d = run(a, r.from[0], r.roles[0]);
      return d.ok && d.supersedes;
    });
    expect(supers).toEqual(["activate"]);
  });

  it("there are 8 states and none can be reached without a rule", () => {
    expect(STATES).toHaveLength(8);
    const reachable = new Set<State>(["draft", ...ACTIONS.map((a) => RULES[a].to), "superseded"]);
    expect([...reachable].sort()).toEqual([...STATES].sort());
  });

  it("lists the actions available from each state", () => {
    expect(actionsFrom("in_review")).toEqual(["request_changes", "send_for_approval"]);
    expect(actionsFrom("superseded")).toEqual([]);
  });
});

describe("lifecycle guards", () => {
  it.each(["request_changes", "send_for_approval", "reject", "approve"] as const)("nobody can %s their own version", (action) => {
    const state = RULES[action].from[0];
    const role = RULES[action].roles[0];
    expect(run(action, state, role, { actorId: "author-1" })).toMatchObject({ ok: false, code: "own_document" });
  });

  it("an author can still submit and withdraw their own version", () => {
    expect(run("submit", "draft", "author", { actorId: "author-1" }).ok).toBe(true);
    expect(run("withdraw", "draft", "author", { actorId: "author-1" }).ok).toBe(true);
  });

  it.each(["send_for_approval", "approve"] as const)("open critical comments block %s", (action) => {
    const d = run(action, RULES[action].from[0], RULES[action].roles[0], { openCriticalComments: 2 });
    expect(d).toEqual({ ok: false, code: "critical_comments_open", reason: "2 critical comments are still open." });
    const one = run(action, RULES[action].from[0], RULES[action].roles[0], { openCriticalComments: 1 });
    expect(one).toMatchObject({ reason: "1 critical comment is still open." });
  });

  it("critical comments don't block other actions", () => {
    expect(run("request_changes", "in_review", "reviewer", { openCriticalComments: 3 }).ok).toBe(true);
    expect(run("reject", "pending_approval", "approver", { openCriticalComments: 3 }).ok).toBe(true);
  });

  it.each(["submit", "activate"] as const)("invalid metadata blocks %s", (action) => {
    const d = run(action, RULES[action].from[0], RULES[action].roles[0], { metadataErrors: ["pick a category"] });
    expect(d).toEqual({ ok: false, code: "invalid_metadata", reason: "Fix the document details first: pick a category." });
  });

  it("invalid metadata does not block review decisions", () => {
    expect(run("request_changes", "in_review", "reviewer", { metadataErrors: ["x"] }).ok).toBe(true);
  });

  it("an actor with several roles gets any of them", () => {
    const d = decide({ action: "approve", state: "pending_approval", actor: { id: "z", roles: ["reader", "approver"] }, ...base });
    expect(d.ok).toBe(true);
  });
});

describe("version numbers", () => {
  it("starts at 1.0 and bumps minor or major", () => {
    expect(nextVersion(null, "major")).toEqual({ major: 1, minor: 0 });
    expect(nextVersion({ major: 1, minor: 2 }, "minor")).toEqual({ major: 1, minor: 3 });
    expect(nextVersion({ major: 1, minor: 2 }, "major")).toEqual({ major: 2, minor: 0 });
    expect(formatVersion({ major: 2, minor: 0 })).toBe("2.0");
  });
});

describe("metadata validation", () => {
  const good = { title: "Information Security Policy", category: "policy", owner: "IT", reviewCycleMonths: 12, dir: "ltr" };
  it("accepts complete metadata", () => expect(metadataErrors(good)).toEqual([]));
  it("reports each problem in plain words", () => {
    expect(metadataErrors({ ...good, title: " ", category: "memo", reviewCycleMonths: 0 })).toEqual([
      "title needs at least 3 characters",
      "pick a category",
      "review cycle must be at least 1 month",
    ]);
  });
});
