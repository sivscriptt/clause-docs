import { describe, expect, it } from "vitest";
import { deleteClause, indentClause, moveClause, numberClauses, outdentClause, plainText, resolveXrefs, TreeError } from "@/lib/doc/tree";
import { c, doc, p, sample, t } from "./fixtures";

const nums = (d: Parameters<typeof numberClauses>[0]) => Object.fromEntries(numberClauses(d));

describe("clause numbering", () => {
  it("numbers nested clauses 1, 1.1, 1.1.1", () => {
    const d = doc(c("a", "A", c("b", "B", c("c", "C"))), c("d", "D"));
    expect(nums(d)).toEqual({ a: "1", b: "1.1", c: "1.1.1", d: "2" });
  });

  it("ignores non-clause blocks when counting", () => {
    const d = doc(p(t("Preamble")), c("a", "A"), p(t("note")), c("b", "B"));
    expect(nums(d)).toEqual({ a: "1", b: "2" });
  });

  it("returns nothing for a document with no clauses", () => {
    expect(nums(doc())).toEqual({});
  });

  it("renumbers everything after a moved clause", () => {
    const d = moveClause(sample(), "duties", null, 0);
    expect(nums(d)).toEqual({ duties: "1", purpose: "2", scope: "3", staff: "3.1", contractors: "3.2" });
  });

  it("moves into another clause at a given position", () => {
    const d = moveClause(sample(), "purpose", "scope", 1);
    expect(nums(d)).toEqual({ scope: "1", staff: "1.1", purpose: "1.2", contractors: "1.3", duties: "2" });
  });

  it("appends when the position is past the end", () => {
    const d = moveClause(sample(), "purpose", "scope", 99);
    expect(nums(d).purpose).toBe("1.3");
  });

  it("refuses to move a clause into itself or its own child", () => {
    expect(() => moveClause(sample(), "scope", "scope", 0)).toThrow(TreeError);
    expect(() => moveClause(sample(), "scope", "staff", 0)).toThrow(TreeError);
  });

  it("refuses unknown clauses", () => {
    expect(() => moveClause(sample(), "nope", null, 0)).toThrow(TreeError);
    expect(() => moveClause(sample(), "purpose", "nope", 0)).toThrow(TreeError);
  });

  it("indents under the previous sibling", () => {
    const d = indentClause(sample(), "scope");
    expect(nums(d)).toEqual({ purpose: "1", scope: "1.1", staff: "1.1.1", contractors: "1.1.2", duties: "2" });
  });

  it("indent skips over non-clause siblings to find the previous clause", () => {
    const d = indentClause(doc(c("a", "A"), p(t("note")), c("b", "B")), "b");
    expect(nums(d)).toEqual({ a: "1", b: "1.1" });
  });

  it("will not indent the first clause at a level", () => {
    expect(() => indentClause(sample(), "purpose")).toThrow(TreeError);
    expect(() => indentClause(sample(), "staff")).toThrow(TreeError);
  });

  it("outdents to just after the parent", () => {
    const d = outdentClause(sample(), "staff");
    expect(nums(d)).toEqual({ purpose: "1", scope: "2", contractors: "2.1", staff: "3", duties: "4" });
  });

  it("will not outdent a top-level clause", () => {
    expect(() => outdentClause(sample(), "purpose")).toThrow(TreeError);
  });

  it("deleting a clause renumbers the rest and drops its children", () => {
    const d = deleteClause(sample(), "scope");
    expect(nums(d)).toEqual({ purpose: "1", duties: "2" });
  });

  it("does not mutate the input", () => {
    const before = sample();
    const copy = structuredClone(before);
    moveClause(before, "duties", null, 0);
    indentClause(before, "scope");
    outdentClause(before, "staff");
    deleteClause(before, "scope");
    expect(before).toEqual(copy);
  });
});

describe("cross-references", () => {
  it("show the current number of their target", () => {
    expect(resolveXrefs(sample())).toEqual([
      { target: "purpose", label: "1", broken: false },
      { target: "staff", label: "2.1", broken: false },
    ]);
  });

  it("follow their target when it moves", () => {
    const d = moveClause(sample(), "staff", null, 0);
    expect(resolveXrefs(d).find((r) => r.target === "staff")?.label).toBe("1");
    expect(resolveXrefs(d).find((r) => r.target === "purpose")?.label).toBe("2");
  });

  it("are flagged when the target is deleted", () => {
    const d = deleteClause(sample(), "purpose");
    expect(resolveXrefs(d)[0]).toEqual({ target: "purpose", label: "[missing clause]", broken: true });
  });

  it("are flagged when the target's parent is deleted", () => {
    const d = deleteClause(sample(), "scope");
    // the xref inside contractors went with it; the one in duties pointed at staff
    expect(resolveXrefs(d)).toEqual([{ target: "staff", label: "[missing clause]", broken: true }]);
  });
});

describe("plain text for search", () => {
  it("prefixes clause numbers, resolves xrefs and drops deleted text", () => {
    const d = doc(
      { type: "clause", attrs: { id: "a" }, content: [p(t("Keep "), t("gone", [{ type: "deletion" }]), t("new", [{ type: "insertion" }])), p(t("second para"))] },
      { type: "clause", attrs: { id: "b" }, content: [p(t("See ")), ] },
    );
    d.content[1].content![0].content!.push({ type: "xref", attrs: { target: "a" } });
    expect(plainText(d)).toBe("1 Keep new\nsecond para\n2 See 1");
  });

  it("handles a clause with only child clauses and unknown xrefs", () => {
    const d = doc({ type: "clause", attrs: { id: "a" }, content: [c("b", "B")] }, p(t("x"), { type: "xref", attrs: { target: "zz" } }));
    expect(plainText(d)).toBe("1\n1.1 B");
  });
});
