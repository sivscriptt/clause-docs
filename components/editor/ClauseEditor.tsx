"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { deleteClause, indentClause, moveClause, numberClauses, outdentClause, TreeError } from "@/lib/doc/tree";
import type { Doc, PMNode } from "@/lib/doc/types";
import { cleanView, originalView } from "@/lib/doc/views";
import { authorNames, Clause, Deletion, Insertion, Numbering, trackKey, TrackChanges, Xref } from "./extensions";

type Props = {
  initial: Doc;
  author: string;
  names: Record<string, string>;
  onChange: (doc: Doc) => void;
  onClause: (id: string | null) => void;
  dir: "ltr" | "rtl";
};

/** Clause id at the cursor, innermost first. */
function clauseAtCursor(editor: Editor): string | null {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "clause") return n.attrs.id;
  }
  return null;
}

function replaceDoc(editor: Editor, json: Doc, focusId?: string | null) {
  const node = editor.schema.nodeFromJSON(json);
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content).setMeta("skipTracking", true);
  editor.view.dispatch(tr);
  if (focusId) {
    let target = -1;
    editor.state.doc.descendants((n, pos) => {
      if (target < 0 && n.type.name === "clause" && n.attrs.id === focusId) target = pos + 2;
      return target < 0;
    });
    if (target > 0) editor.chain().focus().setTextSelection(target).scrollIntoView().run();
  }
}

/** [parent clause id | null, position among clause siblings] */
function where(doc: PMNode, id: string, parent: string | null = null): [string | null, number] | null {
  let i = 0;
  for (const c of doc.content ?? []) {
    if (c.type !== "clause") continue;
    if (c.attrs?.id === id) return [parent, i];
    const deeper = where(c, id, String(c.attrs?.id));
    if (deeper) return deeper;
    i++;
  }
  return null;
}

function outline(doc: PMNode): { id: string; num: string; text: string }[] {
  const nums = numberClauses(doc);
  const out: { id: string; num: string; text: string }[] = [];
  const first = (n: PMNode): string => (n.text ?? "") + (n.content ?? []).filter((c) => c.type !== "clause").map(first).join("");
  const walk = (n: PMNode) =>
    n.content?.forEach((c) => {
      if (c.type !== "clause") return;
      const id = String(c.attrs?.id);
      out.push({ id, num: nums.get(id)!, text: first(c.content?.[0] ?? {type: "text"}).slice(0, 60) });
      walk(c);
    });
  walk(doc);
  return out;
}

const btn =
  "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-ink hover:bg-paper disabled:cursor-not-allowed disabled:text-muted/60 disabled:hover:bg-transparent";

export function ClauseEditor({ initial, author, names, onChange, onClause, dir }: Props) {
  Object.assign(authorNames, names);
  const [message, setMessage] = useState<string | null>(null);
  // Holds the clause id being confirmed, so moving the cursor cancels it.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Re-render on every transaction so the toolbar reflects the cursor and document.
  const [, setTick] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    textDirection: "auto",
    extensions: [
      StarterKit.configure({
        heading: false, codeBlock: false, blockquote: false, horizontalRule: false, code: false,
        strike: false, link: false, underline: false, trailingNode: false,
      }),
      Clause, Xref, Insertion, Deletion, Numbering,
      TrackChanges.configure({ author, on: true }),
    ],
    content: initial,
    editorProps: { attributes: { class: "doc", "aria-label": "Document text", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as Doc),
    onSelectionUpdate: ({ editor }) => onClause(clauseAtCursor(editor)),
    onTransaction: () => setTick((t) => t + 1),
  });

  const pmDoc = editor?.state.doc ?? null;
  const json = useMemo(() => (pmDoc ? (pmDoc.toJSON() as Doc) : initial), [pmDoc, initial]);
  const clauses = useMemo(() => outline(json), [json]);
  const tracking = editor ? (trackKey.getState(editor.state)?.on ?? false) : true;
  const cur = editor ? clauseAtCursor(editor) : null;
  const loc = cur ? where(json, cur) : null;

  if (!editor) return <div className="doc min-h-48 animate-pulse rounded-md bg-paper" aria-busy="true" />;

  const apply = (fn: (d: Doc) => Doc, focus: string | null) => {
    try {
      replaceDoc(editor, fn(editor.getJSON() as Doc), focus);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof TreeError ? e.message.replace(/^./, (c) => c.toUpperCase()) + "." : "That didn't work.");
    }
  };

  const newClause = (asChild: boolean) => {
    const id = nanoid(8);
    const node: PMNode = { type: "clause", attrs: { id }, content: [{ type: "paragraph" }] };
    apply((d) => {
      const next = structuredClone(d);
      if (!cur || !loc) {
        next.content.push(node);
        return next;
      }
      const tmp = { ...next, content: [...next.content, node] } as Doc;
      return moveClause(tmp, id, asChild ? cur : loc[0], asChild ? 999 : loc[1] + 1);
    }, id);
  };

  const toggleTracking = () => editor.view.dispatch(editor.state.tr.setMeta("setTracking", { on: !tracking, author }));

  return (
    <div className="flex flex-col gap-3">
      <div role="toolbar" aria-label="Clause tools" className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-white/95 p-1 backdrop-blur">
        <label className="me-1 flex h-8 cursor-pointer items-center gap-2 rounded-full px-2.5 text-sm font-medium hover:bg-paper">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={tracking} onChange={toggleTracking} />
          Track changes
        </label>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} onClick={() => newClause(false)} title="Add a clause after this one">+ Clause</button>
        <button type="button" className={btn} onClick={() => newClause(true)} disabled={!cur} title="Add a sub-clause inside this one">+ Sub-clause</button>
        <button type="button" className={btn} disabled={!cur} onClick={() => apply((d) => indentClause(d, cur!), cur)} title={`Make this a sub-clause of the one above (Alt+Shift+${dir === "rtl" ? "←" : "→"})`}>Indent</button>
        <button type="button" className={btn} disabled={!loc?.[0]} onClick={() => apply((d) => outdentClause(d, cur!), cur)} title={`Move this clause up a level (Alt+Shift+${dir === "rtl" ? "→" : "←"})`}>Outdent</button>
        <button type="button" className={btn} disabled={!loc || loc[1] === 0} onClick={() => apply((d) => moveClause(d, cur!, loc![0], loc![1] - 1), cur)} aria-label="Move clause up">↑ Up</button>
        <button type="button" className={btn} disabled={!loc} onClick={() => apply((d) => moveClause(d, cur!, loc![0], loc![1] + 1), cur)} aria-label="Move clause down">↓ Down</button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only">Insert a reference to clause</span>
          <select
            className="h-8 max-w-44 rounded-md border border-line-strong bg-white ps-2 pe-7 text-sm"
            value=""
            onChange={(e) => {
              if (e.target.value) editor.chain().focus().insertContent({ type: "xref", attrs: { target: e.target.value } }).run();
            }}
          >
            <option value="">Insert reference…</option>
            {clauses.map((c) => (
              <option key={c.id} value={c.id}>{c.num} {c.text}</option>
            ))}
          </select>
        </label>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} onClick={() => apply((d) => cleanView(d) as Doc, cur)} title="Accept every tracked change">Accept all</button>
        <button type="button" className={btn} onClick={() => apply((d) => originalView(d) as Doc, cur)} title="Reject every tracked change">Reject all</button>
        <span className="flex-1" />
        {confirmDelete !== null && confirmDelete === cur ? (
          <span className="flex items-center gap-1" role="group" aria-label="Confirm delete">
            <button type="button" className={`${btn} bg-del text-white hover:bg-del/90`} onClick={() => { apply((d) => deleteClause(d, cur!), null); setConfirmDelete(null); }}>
              Delete clause {loc && clauses.find((c) => c.id === cur)?.num}
            </button>
            <button type="button" className={btn} onClick={() => setConfirmDelete(null)}>Keep</button>
          </span>
        ) : (
          <button type="button" className={`${btn} text-del`} disabled={!cur} onClick={() => setConfirmDelete(cur)}>Delete clause…</button>
        )}
      </div>
      <p className="no-print text-xs text-muted">
        {tracking
          ? "Tracking is on: your typing shows as additions and deletions with your name. Clause moves and new clauses are not tracked."
          : "Tracking is off: edits change the text directly."}
      </p>
      {message && <p role="alert" className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">{message}</p>}
      <div
        onKeyDown={(e) => {
          if (!e.altKey || !e.shiftKey || !cur) return;
          const map: Record<string, () => void> = {
            ArrowRight: () => apply((d) => indentClause(d, cur), cur),
            ArrowLeft: () => apply((d) => outdentClause(d, cur), cur),
            ArrowUp: () => loc && loc[1] > 0 && apply((d) => moveClause(d, cur, loc[0], loc[1] - 1), cur),
            ArrowDown: () => loc && apply((d) => moveClause(d, cur, loc[0], loc[1] + 1), cur),
          };
          // In right-to-left documents "indent" points left.
          const key = dir === "rtl" && e.key === "ArrowLeft" ? "ArrowRight" : dir === "rtl" && e.key === "ArrowRight" ? "ArrowLeft" : e.key;
          const fn = map[key];
          if (fn) { e.preventDefault(); fn(); }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
