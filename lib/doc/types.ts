// ProseMirror/TipTap JSON, narrowed to what the document model uses.
export type Mark = { type: string; attrs?: Record<string, unknown> };

export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Mark[];
};

export type Doc = PMNode & { type: "doc"; content: PMNode[] };

export const isClause = (n: PMNode) => n.type === "clause";
export const clauseId = (n: PMNode) => String(n.attrs?.id ?? "");
