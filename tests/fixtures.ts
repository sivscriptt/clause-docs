import type { Doc, PMNode } from "@/lib/doc/types";

export const p = (...content: PMNode[]): PMNode => ({ type: "paragraph", content });
export const t = (text: string, marks?: PMNode["marks"]): PMNode => (marks ? { type: "text", text, marks } : { type: "text", text });
export const x = (target: string): PMNode => ({ type: "xref", attrs: { target } });
export const c = (id: string, text: string, ...kids: PMNode[]): PMNode => ({
  type: "clause",
  attrs: { id },
  content: [p(t(text)), ...kids],
});
export const doc = (...content: PMNode[]): Doc => ({ type: "doc", content });

/**
 * 1 Purpose
 * 2 Scope
 *   2.1 Staff
 *   2.2 Contractors (see 1)
 * 3 Duties (see 2.1)
 */
export const sample = () =>
  doc(
    c("purpose", "Purpose"),
    c("scope", "Scope", c("staff", "Staff"), { type: "clause", attrs: { id: "contractors" }, content: [p(t("Contractors, see "), x("purpose"))] }),
    { type: "clause", attrs: { id: "duties" }, content: [p(t("Duties, see "), x("staff"))] },
  );
