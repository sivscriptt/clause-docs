import { describe, expect, it } from "vitest";
import { cleanView, listChanges, originalView } from "@/lib/doc/views";
import { doc, p, t } from "./fixtures";

const ins = (author = "aisha", at = "2026-11-05T10:00:00Z") => [{ type: "insertion", attrs: { author, at } }];
const del = (author = "aisha", at = "2026-11-05T10:00:00Z") => [{ type: "deletion", attrs: { author, at } }];

const tracked = () =>
  doc({
    type: "clause",
    attrs: { id: "a" },
    content: [p(t("Staff must "), t("never ", del()), t("always ", ins()), t("lock screens.", [{ type: "bold" }]))],
  });

const text = (d: ReturnType<typeof doc>) => JSON.stringify(d).match(/"text":"[^"]*"/g)!.map((s) => s.slice(8, -1)).join("");

describe("view modes", () => {
  it("clean view accepts every change", () => {
    const v = cleanView(tracked()) as ReturnType<typeof doc>;
    expect(text(v)).toBe("Staff must always lock screens.");
    expect(JSON.stringify(v)).not.toMatch(/insertion|deletion/);
  });

  it("original view rejects every change", () => {
    const v = originalView(tracked()) as ReturnType<typeof doc>;
    expect(text(v)).toBe("Staff must never lock screens.");
    expect(JSON.stringify(v)).not.toMatch(/insertion|deletion/);
  });

  it("keeps unrelated marks", () => {
    const v = JSON.stringify(cleanView(tracked()));
    expect(v).toContain('"bold"');
  });

  it("keeps other marks on changed text and nodes without content", () => {
    const d = doc(p(t("x", [{ type: "insertion" }, { type: "italic" }])), { type: "horizontalRule" });
    const v = cleanView(d);
    expect(v.content![0].content![0].marks).toEqual([{ type: "italic" }]);
    expect(v.content![1]).toEqual({ type: "horizontalRule" });
  });

  it("does not mutate the stored document", () => {
    const d = tracked();
    const copy = structuredClone(d);
    cleanView(d);
    originalView(d);
    expect(d).toEqual(copy);
  });
});

describe("proposed changes list", () => {
  it("lists each change with author, time and clause", () => {
    expect(listChanges(tracked())).toEqual([
      { kind: "deletion", text: "never ", author: "aisha", at: "2026-11-05T10:00:00Z", clause: "a" },
      { kind: "insertion", text: "always ", author: "aisha", at: "2026-11-05T10:00:00Z", clause: "a" },
    ]);
  });

  it("merges adjacent runs by the same author, but not across authors, kinds or blocks", () => {
    const d = doc(
      p(t("ab", ins()), t("cd", [...ins(), { type: "bold" }]), t("ef", ins("hassan"))),
      p(t("gh", ins("hassan"))),
      p(t("ij", ins()), t(" plain "), t("kl", ins())),
    );
    expect(listChanges(d).map((c) => [c.text, c.author, c.clause])).toEqual([
      ["abcd", "aisha", null],
      ["ef", "hassan", null],
      ["gh", "hassan", null],
      ["ij", "aisha", null],
      ["kl", "aisha", null],
    ]);
  });

  it("tolerates marks without attributes", () => {
    expect(listChanges(doc(p(t("x", [{ type: "deletion" }]))))).toEqual([{ kind: "deletion", text: "x", author: "", at: "", clause: null }]);
  });
});
