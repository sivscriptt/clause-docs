import type { Mark, PMNode } from "./types";

export type ChangeKind = "insertion" | "deletion";
export type Change = { kind: ChangeKind; text: string; author: string; at: string; clause: string | null };

const has = (n: PMNode, t: ChangeKind) => n.marks?.some((m) => m.type === t) ?? false;
const strip = (marks: Mark[] | undefined, t: ChangeKind) => {
  const kept = marks?.filter((m) => m.type !== t);
  return kept && kept.length ? kept : undefined;
};

function project(node: PMNode, drop: ChangeKind, keep: ChangeKind): PMNode | null {
  if (node.type === "text") {
    if (has(node, drop)) return null;
    const marks = strip(node.marks, keep);
    const rest = { ...node };
    delete rest.marks;
    return marks ? { ...rest, marks } : rest;
  }
  if (!node.content) return node;
  const content = node.content.map((c) => project(c, drop, keep)).filter((c): c is PMNode => c !== null);
  return { ...node, content };
}

/** Clean revised text: every proposed change accepted. */
export const cleanView = (doc: PMNode) => project(doc, "deletion", "insertion")!;
/** The text as it was before any proposed change: every change rejected. */
export const originalView = (doc: PMNode) => project(doc, "insertion", "deletion")!;

/** Flat list of proposed changes. Adjacent runs by the same author in the same block are merged. */
export function listChanges(doc: PMNode): Change[] {
  const out: Change[] = [];
  let canMerge = false;
  const walk = (n: PMNode, clause: string | null) => {
    if (n.type !== "text") {
      const here = n.type === "clause" ? String(n.attrs?.id) : clause;
      canMerge = false; // a new block always starts a new change
      n.content?.forEach((c) => walk(c, here));
      canMerge = false;
      return;
    }
    const m = n.marks?.find((x) => x.type === "insertion" || x.type === "deletion");
    if (!m) { canMerge = false; return; }
    const kind = m.type as ChangeKind;
    const author = String(m.attrs?.author ?? "");
    const at = String(m.attrs?.at ?? "");
    const last = out.at(-1);
    if (canMerge && last && last.kind === kind && last.author === author) last.text += n.text ?? "";
    else out.push({ kind, text: n.text ?? "", author, at, clause });
    canMerge = true;
  };
  walk(doc, null);
  return out;
}
