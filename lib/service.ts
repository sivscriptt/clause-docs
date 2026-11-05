import { nanoid } from "nanoid";
import type pg from "pg";
import { can, type Actor } from "./auth";
import { conflict, forbidden, invalid, notFound, ServiceError } from "./errors";
import { metadataErrors, Metadata } from "./doc/metadata";
import { plainText } from "./doc/tree";
import { cleanView } from "./doc/views";
import type { Doc } from "./doc/types";
import { decide, RULES, type Action, type State } from "./lifecycle/machine";
import { formatVersion, nextVersion, type Target } from "./lifecycle/version";
import { tx } from "./db/client";

export type VersionRow = {
  id: string;
  document_id: string;
  major: number;
  minor: number;
  state: State;
  content: Doc;
  author_id: string;
  author_name: string;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
};

export type CommentRow = {
  id: string;
  clause_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  critical: boolean;
  resolved_at: Date | null;
  created_at: Date;
};

const EDITABLE: State[] = ["draft", "changes_requested"];

async function audit(db: pg.Client, actor: Actor, action: string, entity: string, entityId: string, data: object = {}) {
  await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)", [
    actor.id,
    action,
    entity,
    entityId,
    data,
  ]);
}

export async function getActor(db: pg.Client, id: string | null): Promise<Actor | null> {
  if (!id) return null;
  const r = await db.query<Actor>("SELECT id, name, roles FROM users WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export const listUsers = async (db: pg.Client) =>
  (await db.query<Actor>("SELECT id, name, roles FROM users ORDER BY array_position(ARRAY['author','reviewer','approver','reader','admin'], roles[1])")).rows;

/** Documents this actor may see, optionally filtered by a full-text query (any script, incl. Thaana). */
export async function listDocuments(db: pg.Client, actor: Actor, q = "") {
  const query = q.trim();
  const drafts = can.seeDrafts(actor);
  const r = await db.query<{
    id: string;
    metadata: Metadata;
    version_id: string;
    state: State;
    major: number;
    minor: number;
    updated_at: Date;
    snippet: string | null;
  }>(
    `SELECT DISTINCT ON (d.id) d.id, d.metadata, v.id AS version_id, v.state, v.major, v.minor, v.updated_at,
            CASE WHEN $1 = '' THEN NULL ELSE
              substring(v.plain_text FROM greatest(1, strpos(lower(v.plain_text), lower($1)) - 40) FOR 140) END AS snippet
       FROM documents d
       JOIN versions v ON v.document_id = d.id
      WHERE ($2 OR v.state = 'active')
        AND v.state NOT IN ('superseded', 'retired')
        AND ($1 = '' OR v.plain_text ILIKE '%' || $3 || '%' OR d.metadata->>'title' ILIKE '%' || $3 || '%')
      ORDER BY d.id, (v.state = 'active') ASC, v.major DESC, v.minor DESC`,
    [query, drafts, query.replace(/[\\%_]/g, (m) => "\\" + m)],
  );
  return r.rows.sort((a, b) => a.metadata.title.localeCompare(b.metadata.title));
}

export async function getDocument(db: pg.Client, actor: Actor, id: string) {
  const d = await db.query<{ id: string; metadata: Metadata }>("SELECT id, metadata FROM documents WHERE id = $1", [id]);
  if (!d.rows[0]) throw notFound("Document");
  const versions = (
    await db.query<VersionRow>(
      `SELECT v.*, u.name AS author_name FROM versions v JOIN users u ON u.id = v.author_id
        WHERE v.document_id = $1 ORDER BY v.major DESC, v.minor DESC`,
      [id],
    )
  ).rows.filter((v) => can.seeDrafts(actor) || v.state === "active" || v.state === "superseded");
  if (!versions.length) throw notFound("Document");
  return { ...d.rows[0], versions };
}

export async function getVersion(db: pg.Client, actor: Actor, versionId: string) {
  const r = await db.query<VersionRow & { metadata: Metadata }>(
    `SELECT v.*, u.name AS author_name, d.metadata FROM versions v
       JOIN users u ON u.id = v.author_id JOIN documents d ON d.id = v.document_id WHERE v.id = $1`,
    [versionId],
  );
  const v = r.rows[0];
  if (!v || (!can.seeDrafts(actor) && v.state !== "active" && v.state !== "superseded")) throw notFound("Version");
  return v;
}

export async function saveContent(db: pg.Client, actor: Actor, versionId: string, content: Doc) {
  if (!can.edit(actor)) throw forbidden("Only authors can edit.");
  if (content?.type !== "doc" || !Array.isArray(content.content)) throw invalid("content must be a document.");
  return tx(db, async () => {
    const v = await lockVersion(db, versionId);
    if (!EDITABLE.includes(v.state)) throw conflict("not_editable", `A version that is ${v.state.replace("_", " ")} can't be edited.`);
    await db.query("UPDATE versions SET content = $2, plain_text = $3, updated_at = now() WHERE id = $1", [
      versionId,
      content,
      plainText(content),
    ]);
    await audit(db, actor, "edit", "version", versionId);
  });
}

async function lockVersion(db: pg.Client, id: string) {
  const r = await db.query<VersionRow & { metadata: Metadata }>(
    "SELECT v.*, d.metadata FROM versions v JOIN documents d ON d.id = v.document_id WHERE v.id = $1 FOR UPDATE OF v",
    [id],
  );
  if (!r.rows[0]) throw notFound("Version");
  return r.rows[0];
}

export async function openCriticalCount(db: pg.Client, versionId: string) {
  const r = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM comments WHERE version_id = $1 AND critical AND resolved_at IS NULL",
    [versionId],
  );
  return r.rows[0].n;
}

/**
 * The single path for every state change: lock the row, ask the decision
 * service, write the new state, supersede the old active version if needed,
 * and record it in the audit log. All or nothing.
 */
export async function transition(db: pg.Client, actor: Actor, versionId: string, action: Action, note = "") {
  if (!(action in RULES)) throw invalid(`Unknown action ${action}.`);
  return tx(db, async () => {
    const v = await lockVersion(db, versionId);
    // Lock the document too, so two activations of different versions serialize.
    await db.query("SELECT 1 FROM documents WHERE id = $1 FOR UPDATE", [v.document_id]);
    const decision = decide({
      action,
      state: v.state,
      actor,
      authorId: v.author_id,
      openCriticalComments: await openCriticalCount(db, versionId),
      metadataErrors: metadataErrors(v.metadata),
    });
    if (!decision.ok) throw new ServiceError(decision.code === "forbidden_role" || decision.code === "own_document" ? 403 : 409, decision.code, decision.reason);

    let superseded: string | null = null;
    if (decision.supersedes) {
      const old = await db.query<{ id: string }>(
        "UPDATE versions SET state = 'superseded', updated_at = now() WHERE document_id = $1 AND state = 'active' RETURNING id",
        [v.document_id],
      );
      superseded = old.rows[0]?.id ?? null;
      if (superseded) await audit(db, actor, "supersede", "version", superseded, { by: versionId });
    }
    await db.query(
      `UPDATE versions SET state = $2, updated_at = now(),
              activated_at = CASE WHEN $2 = 'active' THEN now() ELSE activated_at END WHERE id = $1`,
      [versionId, decision.to],
    );
    if (decision.to === "active") {
      // The published text is the clean one: every proposed change accepted.
      const clean = cleanView(v.content) as Doc;
      await db.query("UPDATE versions SET content = $2, plain_text = $3 WHERE id = $1", [versionId, clean, plainText(clean)]);
    }
    await audit(db, actor, action, "version", versionId, { from: v.state, to: decision.to, note: note || undefined, superseded });
    return { from: v.state, to: decision.to, superseded };
  });
}

export async function createDocument(db: pg.Client, actor: Actor, metadata: unknown, content: Doc) {
  if (!can.edit(actor)) throw forbidden("Only authors can create documents.");
  const errors = metadataErrors(metadata);
  if (errors.length) throw invalid(errors.join("; "));
  return tx(db, async () => {
    const id = nanoid(10);
    const v = nextVersion(null, "major");
    const versionId = nanoid(12);
    await db.query("INSERT INTO documents (id, metadata, created_by) VALUES ($1,$2,$3)", [id, metadata, actor.id]);
    await db.query(
      "INSERT INTO versions (id, document_id, major, minor, state, content, plain_text, author_id) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7)",
      [versionId, id, v.major, v.minor, content, plainText(content), actor.id],
    );
    await audit(db, actor, "create", "document", id, { version: formatVersion(v) });
    return { id, versionId };
  });
}

/** Start a new minor or major revision from the active version. */
export async function createRevision(db: pg.Client, actor: Actor, documentId: string, target: Target) {
  if (!can.edit(actor)) throw forbidden("Only authors can start a revision.");
  if (target !== "minor" && target !== "major") throw invalid("target must be minor or major.");
  return tx(db, async () => {
    await db.query("SELECT 1 FROM documents WHERE id = $1 FOR UPDATE", [documentId]);
    const open = await db.query("SELECT 1 FROM versions WHERE document_id = $1 AND state IN ('draft','in_review','changes_requested','pending_approval','approved')", [documentId]);
    if (open.rowCount) throw conflict("revision_open", "This document already has a revision in progress.");
    const latest = await db.query<VersionRow>(
      "SELECT * FROM versions WHERE document_id = $1 ORDER BY major DESC, minor DESC LIMIT 1",
      [documentId],
    );
    const active = await db.query<VersionRow>("SELECT * FROM versions WHERE document_id = $1 AND state = 'active'", [documentId]);
    if (!active.rows[0]) throw conflict("no_active", "Only an active document can be revised.");
    const v = nextVersion(latest.rows[0], target);
    const versionId = nanoid(12);
    await db.query(
      "INSERT INTO versions (id, document_id, major, minor, state, content, plain_text, author_id) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7)",
      [versionId, documentId, v.major, v.minor, active.rows[0].content, plainText(active.rows[0].content), actor.id],
    );
    await audit(db, actor, "revise", "document", documentId, { version: formatVersion(v), target, versionId });
    return { versionId, version: formatVersion(v) };
  });
}

export async function updateMetadata(db: pg.Client, actor: Actor, documentId: string, metadata: unknown) {
  if (!can.edit(actor)) throw forbidden("Only authors can change document details.");
  const errors = metadataErrors(metadata);
  if (errors.length) throw invalid(errors.join("; "));
  return tx(db, async () => {
    const r = await db.query("UPDATE documents SET metadata = $2 WHERE id = $1", [documentId, metadata]);
    if (!r.rowCount) throw notFound("Document");
    await audit(db, actor, "edit_metadata", "document", documentId, { metadata });
  });
}

export async function listComments(db: pg.Client, versionId: string) {
  return (
    await db.query<CommentRow>(
      `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.version_id = $1 ORDER BY c.created_at, c.id`,
      [versionId],
    )
  ).rows;
}

export async function addComment(
  db: pg.Client,
  actor: Actor,
  versionId: string,
  input: { body: string; clauseId?: string | null; parentId?: string | null; critical?: boolean },
) {
  if (!can.comment(actor)) throw forbidden("Readers can't comment.");
  const body = String(input.body ?? "").trim();
  if (!body) throw invalid("Write something first.");
  return tx(db, async () => {
    const v = await lockVersion(db, versionId);
    if (["active", "superseded", "retired"].includes(v.state)) throw conflict("closed", "Comments are closed on this version.");
    let clauseId = input.clauseId ?? null;
    if (input.parentId) {
      const parent = await db.query<{ clause_id: string | null; parent_id: string | null }>(
        "SELECT clause_id, parent_id FROM comments WHERE id = $1 AND version_id = $2",
        [input.parentId, versionId],
      );
      if (!parent.rows[0]) throw notFound("Comment");
      if (parent.rows[0].parent_id) throw invalid("Reply to the first comment in a thread.");
      clauseId = parent.rows[0].clause_id;
    }
    const id = nanoid(12);
    const critical = !input.parentId && Boolean(input.critical);
    await db.query(
      "INSERT INTO comments (id, version_id, clause_id, parent_id, author_id, body, critical) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, versionId, clauseId, input.parentId ?? null, actor.id, body, critical],
    );
    await audit(db, actor, "comment", "version", versionId, { comment: id, critical });
    return { id };
  });
}

/** Critical comments can only be closed by whoever raised them (or an admin). */
export async function resolveComment(db: pg.Client, actor: Actor, commentId: string) {
  return tx(db, async () => {
    const r = await db.query<{ author_id: string; critical: boolean; version_id: string; parent_id: string | null; resolved_at: Date | null; version_author: string }>(
      `SELECT c.author_id, c.critical, c.version_id, c.parent_id, c.resolved_at, v.author_id AS version_author
         FROM comments c JOIN versions v ON v.id = c.version_id WHERE c.id = $1 FOR UPDATE OF c`,
      [commentId],
    );
    const c = r.rows[0];
    if (!c) throw notFound("Comment");
    if (c.parent_id) throw invalid("Resolve the thread, not a reply.");
    if (c.resolved_at) return;
    const admin = actor.roles.includes("admin");
    const allowed = admin || actor.id === c.author_id || (!c.critical && actor.id === c.version_author);
    if (!allowed) throw forbidden(c.critical ? "Only the person who raised a critical comment can resolve it." : "Only the commenter or the author can resolve this.");
    await db.query("UPDATE comments SET resolved_at = now(), resolved_by = $2 WHERE id = $1", [commentId, actor.id]);
    await audit(db, actor, "resolve_comment", "version", c.version_id, { comment: commentId });
  });
}

export async function auditTrail(db: pg.Client, actor: Actor, documentId: string) {
  if (!can.readAudit(actor)) throw forbidden("Your role can't see the audit log.");
  return (
    await db.query<{ id: string; at: Date; actor_name: string; action: string; entity: string; entity_id: string; data: Record<string, unknown> }>(
      `SELECT a.id, a.at, coalesce(u.name, a.actor_id) AS actor_name, a.action, a.entity, a.entity_id, a.data
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE (a.entity = 'document' AND a.entity_id = $1)
           OR (a.entity = 'version' AND a.entity_id IN (SELECT id FROM versions WHERE document_id = $1))
        ORDER BY a.id DESC LIMIT 200`,
      [documentId],
    )
  ).rows;
}
