// Demo data. Usage: DATABASE_URL=... tsx db/seed.ts   (expects a freshly migrated database)
import pg from "pg";
import { clause, del, doc, ins, para, xref } from "../lib/doc/build";
import { plainText } from "../lib/doc/tree";
import type { Doc } from "../lib/doc/types";

const users = [
  ["aisha", "Aishath Rasheed", ["author"]],
  ["hassan", "Hassan Shareef", ["reviewer"]],
  ["mariyam", "Mariyam Nisha", ["approver"]],
  ["ibrahim", "Ibrahim Zahir", ["reader"]],
  ["nadia", "Nadia Ali", ["admin"]],
] as const;

const at = "2026-11-04T09:12:00Z";

const securityV1 = doc(
  clause("sec-purpose", "Purpose. This policy sets the minimum controls for protecting the bank's information and systems."),
  clause(
    "sec-scope",
    "Scope.",
    clause("sec-scope-staff", "All permanent and temporary staff."),
    clause("sec-scope-vendors", ["Contractors and vendors with system access, under the terms in clause ", xref("sec-access"), "."]),
  ),
  clause(
    "sec-access",
    "Access control.",
    clause("sec-access-least", "Access is granted on a least-privilege basis and reviewed every six months."),
    clause("sec-access-mfa", "Multi-factor authentication is required for remote access."),
  ),
  clause("sec-devices", ["Devices. Staff must lock screens when leaving a workstation. Lost devices are reported under clause ", xref("sec-incidents"), "."]),
  clause("sec-incidents", "Incident reporting. Suspected incidents are reported to the IT service desk within one hour."),
);

// v1.1: proposed edits by Aishath, still in review.
const securityV11: Doc = structuredClone(securityV1);
securityV11.content[2].content![2] = clause(
  "sec-access-mfa",
  ["Multi-factor authentication is required for ", del("remote access", "aisha", at), ins("all access to core banking and email", "aisha", at), "."],
);
securityV11.content[3] = clause("sec-devices", [
  "Devices. Staff must lock screens when leaving a workstation",
  ins(" and must not store customer data on personal devices", "aisha", at),
  ". Lost devices are reported under clause ",
  xref("sec-incidents"),
  ".",
]);
securityV11.content[4] = clause("sec-incidents", [
  "Incident reporting. Suspected incidents are reported to the IT service desk within ",
  del("one hour", "aisha", at),
  ins("30 minutes", "aisha", at),
  ".",
]);

const leave = doc(
  clause("lv-purpose", "މަޤްޞަދު. މި ސިޔާސަތުގެ މަޤްޞަދަކީ މުވައްޒަފުންގެ މަސައްކަތު ގަޑިތަކާއި ޗުއްޓީ ކަނޑައެޅުމެވެ."),
  clause(
    "lv-scope",
    "ދާއިރާ. މި ސިޔާސަތު ހިނގަނީ ހުރިހާ މުވައްޒަފުންނަށެވެ.",
    clause("lv-scope-perm", "ދާއިމީ މުވައްޒަފުން."),
    clause("lv-scope-contract", ["ކޮންޓްރެކްޓް މުވައްޒަފުން، މާއްދާ ", xref("lv-annual"), " ގެ ދަށުން."]),
  ),
  clause(
    "lv-annual",
    "އަހަރީ ޗުއްޓީ.",
    clause("lv-annual-days", "ކޮންމެ މުވައްޒަފަކަށް އަހަރަކު 30 ދުވަހުގެ ޗުއްޓީ ލިބޭނެއެވެ."),
    clause("lv-annual-approval", ["ޗުއްޓީ ނެގުމުގެ ކުރިން HR ގެ ހުއްދަ ހޯދަންވާނެއެވެ. ބައްލަވާ މާއްދާ ", xref("lv-scope-perm"), "."]),
  ),
);

/** About 100 printed pages: 40 chapters x 6 clauses x ~140 words. */
function manual(): Doc {
  const sentence =
    "Each branch keeps a signed register of cash movements, reconciles it against the core banking system at the end of the day, and escalates any difference above the threshold to the branch manager and the operations risk team before the next business day begins. ";
  const chapters = Array.from({ length: 40 }, (_, ch) =>
    clause(
      `ops-${ch + 1}`,
      `Chapter ${ch + 1} procedures.`,
      ...Array.from({ length: 6 }, (_, k) =>
        clause(`ops-${ch + 1}-${k + 1}`, [
          sentence.repeat(3),
          ...(k === 5 && ch > 0 ? ["See also clause ", xref(`ops-${ch}-1`), "."] : []),
        ], para(sentence.repeat(2))),
      ),
    ),
  );
  return doc(...chapters);
}

export async function seed(url: string) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    for (const [id, name, roles] of users) await db.query("INSERT INTO users VALUES ($1,$2,$3)", [id, name, roles]);
    const docs: [string, object][] = [
      ["security", { title: "Information Security Policy", category: "policy", owner: "Information Technology", reviewCycleMonths: 12, dir: "ltr" }],
      ["leave", { title: "މަސައްކަތު ގަޑިއާއި ޗުއްޓީގެ ސިޔާސަތު", category: "policy", owner: "Human Resources", reviewCycleMonths: 24, dir: "rtl" }],
      ["ops-manual", { title: "Branch Operations Manual", category: "manual", owner: "Operations", reviewCycleMonths: 12, dir: "ltr" }],
    ];
    for (const [id, metadata] of docs) await db.query("INSERT INTO documents (id, metadata, created_by) VALUES ($1,$2,'aisha')", [id, metadata]);
    const versions: [string, string, number, number, string, Doc][] = [
      ["security-1-0", "security", 1, 0, "active", securityV1],
      ["security-1-1", "security", 1, 1, "in_review", securityV11],
      ["leave-1-0", "leave", 1, 0, "active", leave],
      ["ops-1-0", "ops-manual", 1, 0, "active", manual()],
    ];
    for (const [id, docId, major, minor, state, content] of versions) {
      await db.query(
        `INSERT INTO versions (id, document_id, major, minor, state, content, plain_text, author_id, activated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'aisha', CASE WHEN $5 = 'active' THEN now() END)`,
        [id, docId, major, minor, state, content, plainText(content)],
      );
    }
    await db.query(
      `INSERT INTO comments (id, version_id, clause_id, author_id, body, critical) VALUES
        ('c-mfa', 'security-1-1', 'sec-access-mfa', 'hassan', 'Core banking MFA needs the new token rollout first. Can we add a date?', true),
        ('c-dev', 'security-1-1', 'sec-devices', 'hassan', 'Good addition. Does this cover personal phones with email?', false)`,
    );
    await db.query(
      `INSERT INTO comments (id, version_id, clause_id, parent_id, author_id, body) VALUES
        ('c-dev-r1', 'security-1-1', 'sec-devices', 'c-dev', 'aisha', 'Yes, phones count as personal devices. I will add a definitions clause in 2.0.')`,
    );
    for (const [id] of docs) await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ('aisha','create','document',$1)", [id]);
    await db.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ('aisha','submit','version','security-1-1','{"from":"draft","to":"in_review"}')`,
    );
    await db.query("COMMIT");
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await seed(url);
  console.log("seeded");
}
