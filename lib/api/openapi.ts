import { ACTIONS, ROLES, STATES } from "@/lib/lifecycle/machine";
import { CATEGORIES } from "@/lib/doc/metadata";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const ok = (description: string, schema?: object) => ({
  description,
  ...(schema ? { content: { "application/json": { schema } } } : {}),
});
const errors = {
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
};
const id = (name = "id") => ({ name, in: "path", required: true, schema: { type: "string" } });

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Clause API",
    version: "1.0.0",
    description:
      "Documents, versions, the review and approval lifecycle, comments and the audit log. Every state change goes through one decision service and runs in a single database transaction.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ demoUser: [] }],
  paths: {
    "/documents": {
      get: {
        summary: "List documents the caller can see, with optional full-text search (any script, including Thaana)",
        parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
        responses: { "200": ok("Documents", { type: "array", items: ref("DocumentSummary") }) },
      },
      post: {
        summary: "Create a document with a 1.0 draft",
        requestBody: body({ type: "object", required: ["metadata"], properties: { metadata: ref("Metadata"), content: ref("Content") } }),
        responses: { "201": ok("Created", { type: "object", properties: { id: { type: "string" }, versionId: { type: "string" } } }), "403": errors["403"], "422": { $ref: "#/components/responses/Invalid" } },
      },
    },
    "/documents/{id}": {
      get: { summary: "A document and its versions (without content)", parameters: [id()], responses: { "200": ok("Document"), ...errors } },
    },
    "/documents/{id}/metadata": {
      put: { summary: "Replace the document's metadata", parameters: [id()], requestBody: body(ref("Metadata")), responses: { "204": ok("Saved"), "422": { $ref: "#/components/responses/Invalid" }, ...errors } },
    },
    "/documents/{id}/revisions": {
      post: {
        summary: "Start a minor or major revision from the active version",
        parameters: [id()],
        requestBody: body({ type: "object", required: ["target"], properties: { target: { enum: ["minor", "major"] } } }),
        responses: {
          "201": ok("Revision started", { type: "object", properties: { versionId: { type: "string" }, version: { type: "string", examples: ["1.2"] } } }),
          "409": { $ref: "#/components/responses/Conflict" },
          ...errors,
        },
      },
    },
    "/documents/{id}/audit": {
      get: { summary: "Audit trail, newest first (append-only)", parameters: [id()], responses: { "200": ok("Entries", { type: "array", items: ref("AuditEntry") }), ...errors } },
    },
    "/versions/{id}": {
      get: { summary: "A version with its content", parameters: [id()], responses: { "200": ok("Version", ref("Version")), ...errors } },
    },
    "/versions/{id}/content": {
      put: {
        summary: "Save content. Only drafts and versions sent back for changes are editable.",
        parameters: [id()],
        requestBody: body({ type: "object", required: ["content"], properties: { content: ref("Content") } }),
        responses: { "204": ok("Saved"), "409": { $ref: "#/components/responses/Conflict" }, "422": { $ref: "#/components/responses/Invalid" }, ...errors },
      },
    },
    "/versions/{id}/transitions": {
      post: {
        summary: "Move a version through the lifecycle",
        description:
          "Locks the version, asks the decision service, writes the new state, supersedes the previous active version when activating, and records the audit entry, all in one transaction. Denials come back as 403 (role, separation of duties) or 409 (state, open critical comments, invalid metadata) with a reason a person can read.",
        parameters: [id()],
        requestBody: body({ type: "object", required: ["action"], properties: { action: { enum: ACTIONS }, note: { type: "string" } } }),
        responses: {
          "200": ok("Moved", { type: "object", properties: { from: { enum: STATES }, to: { enum: STATES }, superseded: { type: ["string", "null"] } } }),
          "409": { $ref: "#/components/responses/Conflict" },
          ...errors,
        },
      },
    },
    "/versions/{id}/comments": {
      get: { summary: "Comments on a version, oldest first", parameters: [id()], responses: { "200": ok("Comments", { type: "array", items: ref("Comment") }), ...errors } },
      post: {
        summary: "Comment on a clause or the whole version, or reply to a thread",
        parameters: [id()],
        requestBody: body({
          type: "object",
          required: ["body"],
          properties: { body: { type: "string" }, clauseId: { type: ["string", "null"] }, parentId: { type: ["string", "null"] }, critical: { type: "boolean", description: "Blocks approval until resolved. Ignored on replies." } },
        }),
        responses: { "201": ok("Created", { type: "object", properties: { id: { type: "string" } } }), "409": { $ref: "#/components/responses/Conflict" }, ...errors },
      },
    },
    "/comments/{id}/resolve": {
      post: { summary: "Resolve a thread. Critical threads can only be resolved by whoever raised them, or an admin.", parameters: [id()], responses: { "204": ok("Resolved"), ...errors } },
    },
  },
  components: {
    securitySchemes: {
      demoUser: { type: "apiKey", in: "header", name: "X-Demo-User", description: "Demo only: a user id (aisha, hassan, mariyam, ibrahim, nadia). Production uses the OIDC session." },
    },
    responses: {
      Forbidden: { description: "Not allowed for this role", content: { "application/json": { schema: ref("Error") } } },
      NotFound: { description: "Not found, or not visible to this role", content: { "application/json": { schema: ref("Error") } } },
      Conflict: { description: "Not possible in the current state", content: { "application/json": { schema: ref("Error") } } },
      Invalid: { description: "Validation failed", content: { "application/json": { schema: ref("Error") } } },
    },
    schemas: {
      Error: { type: "object", properties: { code: { type: "string", examples: ["critical_comments_open"] }, message: { type: "string" } } },
      Metadata: {
        type: "object",
        required: ["title", "category", "owner", "reviewCycleMonths", "dir"],
        properties: {
          title: { type: "string", minLength: 3 },
          category: { enum: CATEGORIES },
          owner: { type: "string" },
          reviewCycleMonths: { type: "integer", minimum: 1, maximum: 60 },
          dir: { enum: ["ltr", "rtl"] },
        },
      },
      Content: {
        type: "object",
        description: "TipTap/ProseMirror JSON. `clause` nodes carry a stable `id`; numbers are derived from position. `xref` nodes point at a clause id. Tracked changes are `insertion`/`deletion` marks with author and time.",
        properties: { type: { const: "doc" }, content: { type: "array", items: { type: "object" } } },
      },
      DocumentSummary: {
        type: "object",
        properties: { id: { type: "string" }, metadata: ref("Metadata"), version_id: { type: "string" }, state: { enum: STATES }, major: { type: "integer" }, minor: { type: "integer" }, snippet: { type: ["string", "null"] } },
      },
      Version: {
        type: "object",
        properties: { id: { type: "string" }, document_id: { type: "string" }, major: { type: "integer" }, minor: { type: "integer" }, state: { enum: STATES }, content: ref("Content"), author_id: { type: "string" } },
      },
      Comment: {
        type: "object",
        properties: { id: { type: "string" }, clause_id: { type: ["string", "null"] }, parent_id: { type: ["string", "null"] }, author_id: { type: "string" }, body: { type: "string" }, critical: { type: "boolean" }, resolved_at: { type: ["string", "null"], format: "date-time" } },
      },
      AuditEntry: {
        type: "object",
        properties: { id: { type: "string" }, at: { type: "string", format: "date-time" }, actor_name: { type: "string" }, action: { type: "string" }, entity: { enum: ["document", "version"] }, entity_id: { type: "string" }, data: { type: "object" } },
      },
      Role: { enum: ROLES },
    },
  },
} as const;
