import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "@/db/migrate";
import { seed } from "@/db/seed";
import { clause, doc } from "@/lib/doc/build";
import type { Actor } from "@/lib/auth";
import * as svc from "@/lib/service";
import { ServiceError } from "@/lib/errors";

const url = process.env.TEST_DATABASE_URL;
let db: pg.Client;
const who: Record<string, Actor> = {};

const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (err) => err);
  expect(e, `expected ${code}`).toBeInstanceOf(ServiceError);
  expect({ status: e.status, code: e.code }).toEqual({ status, code });
  return e as ServiceError;
};
const state = async (id: string) => (await db.query("SELECT state FROM versions WHERE id = $1", [id])).rows[0].state;

describe.skipIf(!url)("service against Postgres", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
  });
  afterAll(() => db?.end());
  beforeEach(async () => {
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(url!);
    await seed(url!);
    for (const u of await svc.listUsers(db)) who[u.id] = u;
  });

  it("walks a revision from review to active and supersedes the old version atomically", async () => {
    await rejects(svc.transition(db, who.hassan, "security-1-1", "send_for_approval"), 409, "critical_comments_open");
    await svc.resolveComment(db, who.hassan, "c-mfa");
    await svc.transition(db, who.hassan, "security-1-1", "send_for_approval");
    await svc.transition(db, who.mariyam, "security-1-1", "approve");
    expect(await state("security-1-0")).toBe("active");
    const r = await svc.transition(db, who.mariyam, "security-1-1", "activate");
    expect(r).toEqual({ from: "approved", to: "active", superseded: "security-1-0" });
    expect(await state("security-1-0")).toBe("superseded");
    const active = await db.query("SELECT id FROM versions WHERE document_id = 'security' AND state = 'active'");
    expect(active.rows).toEqual([{ id: "security-1-1" }]);
    const published = await svc.getVersion(db, who.ibrahim, "security-1-1");
    expect(JSON.stringify(published.content)).not.toMatch(/insertion|deletion/);
    expect(JSON.stringify(published.content)).toContain("30 minutes");
    expect(JSON.stringify(published.content)).not.toContain("one hour");
    const trail = await svc.auditTrail(db, who.nadia, "security");
    expect(trail.slice(0, 5).map((a) => a.action)).toEqual(["activate", "supersede", "approve", "send_for_approval", "resolve_comment"]);
  });

  it("activates the first version of a new document with nothing to supersede", async () => {
    const meta = { title: "Vendor Contract Template", category: "contract", owner: "Legal", reviewCycleMonths: 12, dir: "ltr" };
    const { versionId } = await svc.createDocument(db, who.aisha, meta, doc(clause("a", "Parties.")));
    await svc.transition(db, who.aisha, versionId, "submit");
    await svc.transition(db, who.hassan, versionId, "send_for_approval");
    await svc.transition(db, who.mariyam, versionId, "approve");
    expect(await svc.transition(db, who.nadia, versionId, "activate")).toEqual({ from: "approved", to: "active", superseded: null });
  });

  it("rolls back everything when a transition is refused", async () => {
    await rejects(svc.transition(db, who.aisha, "security-1-1", "approve"), 409, "bad_state");
    await rejects(svc.transition(db, who.ibrahim, "security-1-1", "request_changes"), 403, "forbidden_role");
    expect(await state("security-1-1")).toBe("in_review");
    const n = await db.query("SELECT count(*)::int n FROM audit_log WHERE entity_id = 'security-1-1'");
    expect(n.rows[0].n).toBe(1); // only the seeded submit
  });

  it("an approver who wrote the version can't approve it", async () => {
    await db.query("UPDATE users SET roles = '{author,approver}' WHERE id = 'aisha'");
    await svc.resolveComment(db, who.hassan, "c-mfa");
    await svc.transition(db, who.hassan, "security-1-1", "send_for_approval");
    const aisha = (await svc.getActor(db, "aisha"))!;
    await rejects(svc.transition(db, aisha, "security-1-1", "approve"), 403, "own_document");
  });

  it("two approvers racing on the same version: exactly one wins", async () => {
    await svc.resolveComment(db, who.hassan, "c-mfa");
    await svc.transition(db, who.hassan, "security-1-1", "send_for_approval");
    await db.query("INSERT INTO users VALUES ('mohamed','Mohamed Waheed','{approver}')");
    const mohamed = (await svc.getActor(db, "mohamed"))!;
    const other = new pg.Client({ connectionString: url });
    await other.connect();
    try {
      const results = await Promise.allSettled([
        svc.transition(db, who.mariyam, "security-1-1", "approve"),
        svc.transition(other, mohamed, "security-1-1", "approve"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason.code).toBe("bad_state");
    } finally {
      await other.end();
    }
  });

  it("invalid metadata blocks submission", async () => {
    await svc.transition(db, who.hassan, "security-1-1", "request_changes");
    await db.query(`UPDATE documents SET metadata = metadata || '{"owner":""}' WHERE id = 'security'`);
    const e = await rejects(svc.transition(db, who.aisha, "security-1-1", "submit"), 409, "invalid_metadata");
    expect(e.message).toContain("name an owning department");
  });

  it("the database refuses two active versions even if the app had a bug", async () => {
    await expect(db.query("UPDATE versions SET state = 'active' WHERE id = 'security-1-1'")).rejects.toThrow(/one_active_version/);
  });

  describe("audit log", () => {
    it("can't be updated, deleted or truncated", async () => {
      await expect(db.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/append-only/);
      await expect(db.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
      await expect(db.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
    });

    it("is hidden from authors and readers", async () => {
      await rejects(svc.auditTrail(db, who.ibrahim, "security"), 403, "forbidden");
      await rejects(svc.auditTrail(db, who.aisha, "security"), 403, "forbidden");
    });
  });

  describe("editing", () => {
    const newContent = doc(clause("x", "Rewritten."));

    it("only drafts and versions sent back for changes can be edited", async () => {
      await rejects(svc.saveContent(db, who.aisha, "security-1-1", newContent), 409, "not_editable");
      await svc.transition(db, who.hassan, "security-1-1", "request_changes");
      await svc.saveContent(db, who.aisha, "security-1-1", newContent);
      const v = await svc.getVersion(db, who.aisha, "security-1-1");
      expect(v.content).toEqual(newContent);
      expect((await db.query("SELECT plain_text FROM versions WHERE id = 'security-1-1'")).rows[0].plain_text).toBe("1 Rewritten.");
    });

    it("refuses readers, junk content and unknown versions", async () => {
      await rejects(svc.saveContent(db, who.ibrahim, "security-1-1", newContent), 403, "forbidden");
      await rejects(svc.saveContent(db, who.aisha, "security-1-1", { type: "paragraph" } as never), 422, "invalid");
      await rejects(svc.saveContent(db, who.aisha, "nope", newContent), 404, "not_found");
    });

    it("metadata edits are validated", async () => {
      await rejects(svc.updateMetadata(db, who.aisha, "security", { title: "x" }), 422, "invalid");
      await rejects(svc.updateMetadata(db, who.ibrahim, "security", {}), 403, "forbidden");
      const ok = { title: "Security Policy", category: "policy", owner: "IT", reviewCycleMonths: 6, dir: "ltr" };
      await rejects(svc.updateMetadata(db, who.aisha, "missing", ok), 404, "not_found");
      await svc.updateMetadata(db, who.aisha, "security", ok);
    });
  });

  describe("versions", () => {
    it("one revision at a time", async () => {
      await rejects(svc.createRevision(db, who.aisha, "security", "minor"), 409, "revision_open");
    });

    it("minor and major targets number from the latest version", async () => {
      expect((await svc.createRevision(db, who.aisha, "leave", "minor")).version).toBe("1.1");
      await db.query("UPDATE versions SET state = 'retired' WHERE document_id = 'leave' AND minor = 1");
      expect((await svc.createRevision(db, who.aisha, "leave", "major")).version).toBe("2.0");
    });

    it("needs an active version, an author and a real target", async () => {
      await db.query("UPDATE versions SET state = 'retired' WHERE document_id = 'leave'");
      await rejects(svc.createRevision(db, who.aisha, "leave", "minor"), 409, "no_active");
      await rejects(svc.createRevision(db, who.ibrahim, "leave", "minor"), 403, "forbidden");
      await rejects(svc.createRevision(db, who.aisha, "leave", "patch" as never), 422, "invalid");
    });

    it("new documents need valid metadata and an author", async () => {
      await rejects(svc.createDocument(db, who.aisha, { title: "" }, doc()), 422, "invalid");
      await rejects(svc.createDocument(db, who.hassan, {}, doc()), 403, "forbidden");
    });

    it("readers only ever see active and superseded versions", async () => {
      const d = await svc.getDocument(db, who.ibrahim, "security");
      expect(d.versions.map((v) => v.id)).toEqual(["security-1-0"]);
      await rejects(svc.getVersion(db, who.ibrahim, "security-1-1"), 404, "not_found");
      await rejects(svc.getDocument(db, who.ibrahim, "nope"), 404, "not_found");
      await db.query("UPDATE versions SET state = 'retired' WHERE document_id = 'leave'");
      await rejects(svc.getDocument(db, who.ibrahim, "leave"), 404, "not_found");
    });
  });

  describe("comments", () => {
    it("threads replies under the first comment and keeps the clause", async () => {
      const { id } = await svc.addComment(db, who.aisha, "security-1-1", { body: "  Thanks  ", parentId: "c-mfa", critical: true });
      const c = (await svc.listComments(db, "security-1-1")).find((x) => x.id === id)!;
      expect(c).toMatchObject({ body: "Thanks", parent_id: "c-mfa", clause_id: "sec-access-mfa", critical: false });
      await rejects(svc.addComment(db, who.aisha, "security-1-1", { body: "x", parentId: id }), 422, "invalid");
      await rejects(svc.addComment(db, who.aisha, "security-1-1", { body: "x", parentId: "nope" }), 404, "not_found");
    });

    it("refuses readers, empty comments and closed versions", async () => {
      await rejects(svc.addComment(db, who.ibrahim, "security-1-1", { body: "hi" }), 403, "forbidden");
      await rejects(svc.addComment(db, who.hassan, "security-1-1", { body: "   " }), 422, "invalid");
      await rejects(svc.addComment(db, who.hassan, "security-1-0", { body: "late" }), 409, "closed");
    });

    it("only the person who raised a critical comment can resolve it", async () => {
      await rejects(svc.resolveComment(db, who.aisha, "c-mfa"), 403, "forbidden");
      await svc.resolveComment(db, who.nadia, "c-mfa");
      await svc.resolveComment(db, who.nadia, "c-mfa"); // already resolved: no-op
      expect(await svc.openCriticalCount(db, "security-1-1")).toBe(0);
    });

    it("the author can resolve ordinary comments; others can't; replies can't be resolved", async () => {
      await rejects(svc.resolveComment(db, who.mariyam, "c-dev"), 403, "forbidden");
      await svc.resolveComment(db, who.aisha, "c-dev");
      await rejects(svc.resolveComment(db, who.aisha, "c-dev-r1"), 422, "invalid");
      await rejects(svc.resolveComment(db, who.aisha, "nope"), 404, "not_found");
    });

    it("a new critical comment blocks approval again", async () => {
      await svc.resolveComment(db, who.hassan, "c-mfa");
      await svc.addComment(db, who.hassan, "security-1-1", { body: "One more thing", clauseId: "sec-incidents", critical: true });
      await rejects(svc.transition(db, who.hassan, "security-1-1", "send_for_approval"), 409, "critical_comments_open");
    });
  });

  describe("search", () => {
    it("readers search active text only", async () => {
      const r = await svc.listDocuments(db, who.ibrahim, "30 minutes");
      expect(r).toEqual([]);
      const r2 = await svc.listDocuments(db, who.ibrahim, "one hour");
      expect(r2.map((d) => d.version_id)).toEqual(["security-1-0"]);
    });

    it("staff see the version in progress", async () => {
      const r = await svc.listDocuments(db, who.hassan, "30 minutes");
      expect(r.map((d) => d.version_id)).toEqual(["security-1-1"]);
      expect(r[0].snippet).toContain("30 minutes");
    });

    it("finds Thaana text without corrupting it", async () => {
      const r = await svc.listDocuments(db, who.ibrahim, "ޗުއްޓީ");
      expect(r.map((d) => d.id)).toEqual(["leave"]);
      expect(r[0].snippet).toContain("ޗުއްޓީ");
      expect(r[0].metadata.title).toBe("މަސައްކަތު ގަޑިއާއި ޗުއްޓީގެ ސިޔާސަތު");
    });

    it("treats % and _ literally and lists everything for an empty query", async () => {
      expect(await svc.listDocuments(db, who.hassan, "%")).toEqual([]);
      expect((await svc.listDocuments(db, who.hassan)).map((d) => d.id)).toEqual(["ops-manual", "security", "leave"]);
    });

    it("unknown actions are refused before touching the database", async () => {
      await rejects(svc.transition(db, who.nadia, "security-1-1", "explode" as never), 422, "invalid");
    });
  });
});
