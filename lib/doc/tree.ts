import { clauseId, isClause, type Doc, type PMNode } from "./types";

/**
 * Clause numbers are never stored. They are derived from position in the tree,
 * so moving, indenting or deleting a clause renumbers everything after it.
 */
export function numberClauses(doc: PMNode): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: PMNode, prefix: string) => {
    let i = 0;
    for (const child of node.content ?? []) {
      if (!isClause(child)) continue;
      i += 1;
      const num = prefix ? `${prefix}.${i}` : String(i);
      out.set(clauseId(child), num);
      walk(child, num);
    }
  };
  walk(doc, "");
  return out;
}

export type XrefState = { target: string; label: string; broken: boolean };

/** Every cross-reference in the document with the number it currently points at. */
export function resolveXrefs(doc: PMNode): XrefState[] {
  const nums = numberClauses(doc);
  const out: XrefState[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "xref") {
      const target = String(n.attrs?.target ?? "");
      const num = nums.get(target);
      out.push({ target, label: num ?? "[missing clause]", broken: num === undefined });
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

type Loc = { parent: PMNode; index: number; node: PMNode };

function locate(root: PMNode, id: string): Loc | null {
  const kids = root.content ?? [];
  for (let index = 0; index < kids.length; index++) {
    const node = kids[index];
    if (isClause(node) && clauseId(node) === id) return { parent: root, index, node };
    const deeper = locate(node, id);
    if (deeper) return deeper;
  }
  return null;
}

const clone = <T>(v: T): T => structuredClone(v);

export class TreeError extends Error {}

function mustLocate(doc: PMNode, id: string): Loc {
  const loc = locate(doc, id);
  if (!loc) throw new TreeError(`clause ${id} not found`);
  return loc;
}

/** Child position among clause siblings -> raw index in parent.content. */
function rawIndexForClausePosition(parent: PMNode, pos: number): number {
  const kids = parent.content ?? [];
  let seen = 0;
  for (let i = 0; i < kids.length; i++) {
    if (!isClause(kids[i])) continue;
    if (seen === pos) return i;
    seen++;
  }
  return kids.length;
}

/** Move a clause under `parentId` (null = top level) at clause position `pos`. */
export function moveClause(doc: Doc, id: string, parentId: string | null, pos: number): Doc {
  const next = clone(doc);
  const from = mustLocate(next, id);
  const parent = parentId === null ? next : mustLocate(next, parentId).node;
  if (parentId !== null && (parentId === id || locate(from.node, parentId))) {
    throw new TreeError("cannot move a clause inside itself");
  }
  from.parent.content!.splice(from.index, 1);
  parent.content ??= [];
  parent.content.splice(rawIndexForClausePosition(parent, pos), 0, from.node);
  return next;
}

/** Indent: become the last child of the previous sibling clause. */
export function indentClause(doc: Doc, id: string): Doc {
  const next = clone(doc);
  const { parent, index, node } = mustLocate(next, id);
  const kids = parent.content!;
  let prev = -1;
  for (let i = index - 1; i >= 0; i--) if (isClause(kids[i])) { prev = i; break; }
  if (prev < 0) throw new TreeError("first clause at this level cannot be indented");
  kids.splice(index, 1);
  (kids[prev].content ??= []).push(node);
  return next;
}

/** Outdent: become the next sibling of the parent clause. */
export function outdentClause(doc: Doc, id: string): Doc {
  const next = clone(doc);
  const { parent, index, node } = mustLocate(next, id);
  if (parent === next) throw new TreeError("top-level clause cannot be outdented");
  const grand = mustLocate(next, clauseId(parent));
  parent.content!.splice(index, 1);
  grand.parent.content!.splice(grand.index + 1, 0, node);
  return next;
}

export function deleteClause(doc: Doc, id: string): Doc {
  const next = clone(doc);
  const { parent, index } = mustLocate(next, id);
  parent.content!.splice(index, 1);
  return next;
}

/** Plain text for search indexing: clause numbers prefixed, deletions dropped. */
export function plainText(doc: PMNode): string {
  const nums = numberClauses(doc);
  const lines: string[] = [];
  const inline = (n: PMNode): string => {
    if (n.type === "text") return n.marks?.some((m) => m.type === "deletion") ? "" : (n.text ?? "");
    if (n.type === "xref") return nums.get(String(n.attrs?.target)) ?? "";
    return (n.content ?? []).map(inline).join("");
  };
  const walk = (n: PMNode) => {
    if (isClause(n)) {
      const first = n.content?.find((c) => !isClause(c));
      lines.push(`${nums.get(clauseId(n))} ${first ? inline(first) : ""}`.trim());
      n.content?.filter((c) => !isClause(c)).slice(1).forEach((c) => lines.push(inline(c)));
      n.content?.filter(isClause).forEach(walk);
    } else n.content?.forEach(walk);
  };
  walk(doc);
  return lines.filter(Boolean).join("\n");
}
