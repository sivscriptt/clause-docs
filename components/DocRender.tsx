import { Fragment, type ReactNode } from "react";
import { numberClauses } from "@/lib/doc/tree";
import type { PMNode } from "@/lib/doc/types";

const fmt = (at: unknown) =>
  at ? new Date(String(at)).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Indian/Maldives" }) : "";

/** Renders stored document JSON without an editor: reading view, print, clean and compare views. */
export function DocRender({ doc, names = {}, focusClause }: { doc: PMNode; names?: Record<string, string>; focusClause?: string | null }) {
  const nums = numberClauses(doc);
  const render = (n: PMNode, key: number): ReactNode => {
    switch (n.type) {
      case "clause": {
        const id = String(n.attrs?.id);
        return (
          <section key={key} className="clause" data-num={nums.get(id)} data-clause-id={id} id={`clause-${id}`} data-focus={focusClause === id || undefined}>
            {n.content?.map(render)}
          </section>
        );
      }
      case "bulletList":
        return <ul key={key} className="ms-5 list-disc">{n.content?.map(render)}</ul>;
      case "orderedList":
        return <ol key={key} className="ms-5 list-decimal">{n.content?.map(render)}</ol>;
      case "listItem":
        return <li key={key}>{n.content?.map(render)}</li>;
      case "paragraph":
        return <p key={key} dir="auto">{n.content?.map(render)}</p>;
      case "xref": {
        const num = nums.get(String(n.attrs?.target));
        // Real text, so copy, find-in-page and printing keep the number.
        return num ? (
          <a key={key} href={`#clause-${n.attrs?.target}`} className="xref">{num}</a>
        ) : (
          <span key={key} className="xref" data-broken="true">⚠ missing clause</span>
        );
      }
      case "text": {
        let out: ReactNode = n.text;
        for (const m of n.marks ?? []) {
          const who = names[String(m.attrs?.author)] ?? String(m.attrs?.author ?? "");
          if (m.type === "insertion") out = <ins title={`Added by ${who}, ${fmt(m.attrs?.at)}`}>{out}</ins>;
          else if (m.type === "deletion") out = <del title={`Removed by ${who}, ${fmt(m.attrs?.at)}`}>{out}</del>;
          else if (m.type === "bold") out = <strong>{out}</strong>;
          else if (m.type === "italic") out = <em>{out}</em>;
        }
        return <Fragment key={key}>{out}</Fragment>;
      }
      default:
        return <Fragment key={key}>{n.content?.map(render)}</Fragment>;
    }
  };
  return <>{doc.content?.map(render)}</>;
}
