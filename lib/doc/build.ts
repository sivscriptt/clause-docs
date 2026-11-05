import type { Doc, Mark, PMNode } from "./types";

/** Small builders for seed data and tests. */
export const text = (s: string, marks?: Mark[]): PMNode => (marks?.length ? { type: "text", text: s, marks } : { type: "text", text: s });
export const xref = (target: string): PMNode => ({ type: "xref", attrs: { target } });
export const para = (...parts: (PMNode | string)[]): PMNode => ({
  type: "paragraph",
  content: parts.map((p) => (typeof p === "string" ? text(p) : p)),
});
export const clause = (id: string, body: (PMNode | string)[] | string, ...children: PMNode[]): PMNode => ({
  type: "clause",
  attrs: { id },
  content: [Array.isArray(body) ? para(...body) : para(body), ...children],
});
export const doc = (...content: PMNode[]): Doc => ({ type: "doc", content });
export const ins = (s: string, author: string, at: string) => text(s, [{ type: "insertion", attrs: { author, at } }]);
export const del = (s: string, author: string, at: string) => text(s, [{ type: "deletion", attrs: { author, at } }]);
