import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Mark as PMMark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A numbered clause. Its number comes from position, never from stored data. */
export const Clause = Node.create({
  name: "clause",
  group: "block",
  content: "paragraph block* clause*",
  defining: true,
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute("data-id"), renderHTML: (a) => ({ "data-id": a.id }) } };
  },
  parseHTML: () => [{ tag: "section[data-clause]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-clause": "", class: "clause" }), 0],
});

/** Points at a clause by its stable id; the visible number is a decoration. */
export const Xref = Node.create({
  name: "xref",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: null, parseHTML: (el) => el.getAttribute("data-target"), renderHTML: (a) => ({ "data-target": a.target }) } };
  },
  parseHTML: () => [{ tag: "span[data-xref]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-xref": "", class: "xref" })],
  renderText: () => "[ref]",
});

const changeAttrs = {
  author: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-author") },
  at: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-at") },
};
const changeTitle = (verb: string, a: Record<string, unknown>, names: Record<string, string>) =>
  `${verb} by ${names[String(a.author)] ?? a.author ?? "unknown"}${a.at ? `, ${new Date(String(a.at)).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}`;

export const authorNames: Record<string, string> = {};

export const Insertion = Mark.create({
  name: "insertion",
  inclusive: true,
  excludes: "deletion",
  addAttributes: () => changeAttrs,
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: ({ mark }) => ["ins", { "data-author": mark.attrs.author, "data-at": mark.attrs.at, title: changeTitle("Added", mark.attrs, authorNames) }, 0],
});

export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion",
  addAttributes: () => changeAttrs,
  parseHTML: () => [{ tag: "del" }],
  renderHTML: ({ mark }) => ["del", { "data-author": mark.attrs.author, "data-at": mark.attrs.at, title: changeTitle("Removed", mark.attrs, authorNames) }, 0],
});

/** Numbers clauses and labels cross-references on every change. */
export const Numbering = Extension.create({
  name: "numbering",
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const nums = new Map<string, string>();
      const decos: Decoration[] = [];
      const walk = (node: PMNode, offset: number, prefix: string) => {
        let i = 0;
        node.forEach((child, childOffset) => {
          const pos = offset + childOffset;
          if (child.type.name !== "clause") return;
          i += 1;
          const num = prefix ? `${prefix}.${i}` : String(i);
          nums.set(child.attrs.id, num);
          decos.push(Decoration.node(pos, pos + child.nodeSize, { "data-num": num, "aria-label": `Clause ${num}` }));
          walk(child, pos + 1, num);
        });
      };
      walk(doc, 0, "");
      doc.descendants((node, pos) => {
        if (node.type.name !== "xref") return;
        const num = nums.get(node.attrs.target);
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            "data-label": num ?? "missing clause",
            "data-broken": num ? null : "true",
            "aria-label": num ? `see clause ${num}` : "broken reference: the clause was deleted",
          } as Record<string, string>),
        );
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey("numbering"),
        state: { init: (_, s) => build(s.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});

export const trackKey = new PluginKey<{ on: boolean; author: string }>("trackChanges");

/**
 * Suggest mode. Typed text gets an insertion mark; deleted text is put back
 * with a deletion mark instead of disappearing. Deleting your own pending
 * insertion just removes it. Joins across blocks are refused while tracking,
 * so every change stays inside one paragraph and can be attributed.
 */
export const TrackChanges = Extension.create<{ author: string; on: boolean }>({
  name: "trackChanges",
  addOptions: () => ({ author: "", on: false }),
  addProseMirrorPlugins() {
    const opts = this.options;
    const skip = (tr: Transaction) => tr.getMeta(trackKey) || tr.getMeta("history$") || tr.getMeta("skipTracking");
    return [
      new Plugin({
        key: trackKey,
        state: {
          init: () => ({ on: opts.on, author: opts.author }),
          apply: (tr, v) => tr.getMeta("setTracking") ?? v,
        },
        filterTransaction(tr, state) {
          if (!trackKey.getState(state)?.on || skip(tr)) return true;
          return tr.steps.every((step, i) => {
            if (!(step instanceof ReplaceStep)) return true;
            const { from, to } = step as unknown as { from: number; to: number };
            if (from === to) return true;
            const d = tr.docs[i];
            return d.resolve(from).sameParent(d.resolve(to));
          });
        },
        appendTransaction(trs, oldState, newState) {
          const st = trackKey.getState(newState);
          if (!st?.on) return null;
          // Minute precision, so a run of typing shares one mark and stays one span.
          const at = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
          const insMark = newState.schema.marks.insertion.create({ author: st.author, at });
          const delMark = newState.schema.marks.deletion.create({ author: st.author, at });
          const ops: ({ kind: "ins"; from: number; to: number } | { kind: "del"; pos: number; nodes: PMNode[]; back: boolean })[] = [];
          trs.forEach((tr, ti) => {
            if (skip(tr) || !tr.docChanged) return;
            tr.steps.forEach((step, si) => {
              if (!(step instanceof ReplaceStep)) return;
              const { from, to, slice } = step as unknown as { from: number; to: number; slice: { size: number } };
              // map from this step's output to the final document
              const mapOut = (pos: number, assoc: number) => {
                let p = tr.mapping.slice(si + 1).map(pos, assoc);
                for (const later of trs.slice(ti + 1)) p = later.mapping.map(p, assoc);
                return p;
              };
              if (slice.size > 0) ops.push({ kind: "ins", from: mapOut(from, -1), to: mapOut(from + slice.size, 1) });
              if (to > from) {
                const before = tr.docs[si];
                const nodes: PMNode[] = [];
                before.nodesBetween(from, to, (node, pos) => {
                  if (!node.isText) return true;
                  const cut = node.cut(Math.max(0, from - pos), Math.min(node.nodeSize, to - pos));
                  if (cut.marks.some((m: PMMark) => m.type.name === "insertion")) return false; // own pending text: really delete
                  nodes.push(cut.marks.some((m: PMMark) => m.type.name === "deletion") ? cut : cut.mark(delMark.addToSet(cut.marks)));
                  return false;
                });
                // Backspace: leave the cursor before the struck-through text so the next press keeps going left.
                const back = ti === 0 && si === 0 && oldState.selection.empty && oldState.selection.head === to;
                if (nodes.length) ops.push({ kind: "del", pos: mapOut(from, -1), nodes, back });
              }
            });
          });
          if (!ops.length) return null;
          const out = newState.tr;
          let cursor: number | null = null;
          for (const op of ops) {
            if (op.kind === "ins") {
              const a = out.mapping.map(op.from, -1);
              const b = out.mapping.map(op.to, 1);
              if (b > a) {
                out.removeMark(a, b, newState.schema.marks.deletion);
                out.addMark(a, b, insMark);
              }
            } else {
              const p = out.mapping.map(op.pos, -1);
              out.insert(p, Fragment.fromArray(op.nodes));
              if (op.back) cursor = p;
            }
          }
          if (cursor !== null) out.setSelection(TextSelection.create(out.doc, cursor));
          out.setMeta(trackKey, true);
          return out;
        },
      }),
    ];
  },
});
