"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { commentAction, resolveAction, reviseAction, saveAction, transitionAction } from "@/app/actions";
import { DocRender } from "@/components/DocRender";
import { ClauseEditor } from "@/components/editor/ClauseEditor";
import { StateBadge, stateLabel } from "@/components/StateBadge";
import type { Actor } from "@/lib/auth";
import type { Metadata } from "@/lib/doc/metadata";
import { numberClauses } from "@/lib/doc/tree";
import type { Doc } from "@/lib/doc/types";
import { cleanView, listChanges, originalView } from "@/lib/doc/views";
import type { Action, Decision, State } from "@/lib/lifecycle/machine";
import { confirmDiscard } from "@/lib/unsaved";

type Comment = {
  id: string; clause_id: string | null; parent_id: string | null; author_id: string; author_name: string;
  body: string; critical: boolean; resolved_at: string | null; created_at: string;
};

type Props = {
  me: Actor;
  doc: { id: string; metadata: Metadata };
  versions: { id: string; label: string; state: State }[];
  version: { id: string; label: string; state: State; content: Doc; author: string; authorId: string; updatedAt: string };
  previousContent: Doc | null;
  previousLabel: string | null;
  editable: boolean;
  canComment: boolean;
  canSeeHistory: boolean;
  comments: Comment[];
  criticalOpen: number;
  actions: { action: Action; label: string; decision: Decision }[];
  revise: { minor: string; major: string } | null;
  names: Record<string, string>;
};

const VIEWS = [
  { id: "markup", label: "Full markup" },
  { id: "changes", label: "Proposed changes" },
  { id: "clean", label: "Clean" },
  { id: "compare", label: "Side by side" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const CONFIRM: Partial<Record<Action, string>> = {
  activate: "This replaces the current active version for every reader.",
  retire: "Readers will no longer see this document.",
  withdraw: "This version will be closed and can't be edited again.",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Indian/Maldives" });

export function Workspace(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [view, setView] = useState<View>("markup");
  const [content, setContent] = useState<Doc>(p.version.content);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [focusClause, setFocusClause] = useState<string | null>(null);
  const dir = p.doc.metadata.dir;
  const lang = dir === "rtl" ? "dv" : "en";
  const nums = useMemo(() => numberClauses(content), [content]);
  const changes = useMemo(() => listChanges(content), [content]);

  // ProseMirror attrs are null-prototype objects, which server actions refuse. Send plain JSON.
  const plain = (d: Doc) => JSON.parse(JSON.stringify(d)) as Doc;

  const save = () =>
    start(async () => {
      const r = await saveAction(p.doc.id, p.version.id, plain(content));
      if (r.ok) {
        setDirty(false);
        setSaved(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        setError(null);
      } else setError(r.error);
    });

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveRef.current(); }
    };
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    // In-app links don't fire beforeunload, so ask before following one.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && !a.getAttribute("href")?.startsWith("#") && !confirmDiscard()) { e.preventDefault(); e.stopPropagation(); }
    };
    document.body.dataset.unsaved = "true";
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("click", onClick, true);
    return () => {
      delete document.body.dataset.unsaved;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // After a workflow step the page remounts: move focus to the title and announce the new status.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const msg = sessionStorage.getItem("announce");
    if (!msg) return;
    sessionStorage.removeItem("announce");
    titleRef.current?.focus();
    const live = document.getElementById("live");
    if (live) live.textContent = msg;
  }, []);

  const act = (action: Action) =>
    start(async () => {
      setConfirm(null);
      if (dirty) {
        const s = await saveAction(p.doc.id, p.version.id, plain(content));
        if (!s.ok) return setError(s.error);
        setDirty(false);
      }
      const r = await transitionAction(p.doc.id, p.version.id, action);
      if (r.ok) {
        setError(null);
        sessionStorage.setItem("announce", `Status: ${stateLabel(r.data.to)}`);
        router.refresh();
      } else setError(r.error);
    });

  const revise = (target: "minor" | "major") =>
    start(async () => {
      const r = await reviseAction(p.doc.id, target);
      if (r.ok) router.push(`/docs/${p.doc.id}?v=${r.data.versionId}`);
      else setError(r.error);
    });

  const jumpTo = (clauseId: string) => {
    setView("markup");
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-id="${clauseId}"], #clause-${clauseId}`);
      el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    setFocusClause(clauseId);
  };

  // Only the person who raised a critical comment, or an admin, can resolve it. Say so.
  const openCritical = p.comments.filter((c) => c.critical && !c.parent_id && !c.resolved_at);
  const raisers = [...new Set(openCritical.map((c) => c.author_name))];
  const iCanResolve = p.me.roles.includes("admin") || openCritical.every((c) => c.author_id === p.me.id);
  const criticalHint = iCanResolve
    ? `Resolve ${openCritical.length === 1 ? "it" : "them"} in the comments panel.`
    : `Only ${raisers.join(" and ")} (who raised ${openCritical.length === 1 ? "it" : "them"}) or an admin can resolve ${openCritical.length === 1 ? "it" : "them"}. Reply in the comments panel to follow up.`;

  const available = p.actions.filter((a) => a.decision.ok || (a.decision.code !== "forbidden_role" && a.decision.code !== "bad_state"));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Title block */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <Link href="/" className="hover:text-ink hover:underline">Documents</Link>
          </nav>
          <h1 ref={titleRef} tabIndex={-1} className="mt-1 text-2xl font-semibold text-balance outline-none" dir="auto">{p.doc.metadata.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <StateBadge state={p.version.state} />
            <label className="flex items-center gap-1">
              <span>Version</span>
              <select
                className="select h-8"
                value={p.version.id}
                onChange={(e) => {
                  if (confirmDiscard()) router.push(`/docs/${p.doc.id}?v=${e.target.value}`);
                  else e.target.value = p.version.id;
                }}
              >
                {p.versions.map((v) => <option key={v.id} value={v.id}>{v.label} ({stateLabel(v.state).toLowerCase()})</option>)}
              </select>
            </label>
            <span>by {p.version.author}</span>
            <span>· {p.doc.metadata.owner}</span>
            <span>· updated {when(p.version.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/docs/${p.doc.id}/read?v=${p.version.id}`} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-white px-3 text-sm font-medium hover:bg-paper">
            Reading view
          </Link>
          {p.canSeeHistory && (
            <Link href={`/docs/${p.doc.id}/history`} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-white px-3 text-sm font-medium hover:bg-paper">
              History
            </Link>
          )}
        </div>
      </div>

      {/* Lifecycle */}
      {(available.length > 0 || p.revise || p.editable) && (
        <section aria-label="Workflow" className="no-print mt-5 rounded-lg border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            {p.editable && (
              <button
                type="button"
                onClick={save}
                disabled={pending || !dirty}
                className="h-9 rounded-full border border-line-strong bg-white px-3 text-sm font-medium hover:bg-paper disabled:text-muted"
              >
                {dirty ? "Save" : "Saved"}
              </button>
            )}
            {available.map(({ action, label, decision }) =>
              confirm === action ? (
                <span key={action} role="group" aria-label={`Confirm: ${label}`} className="flex flex-wrap items-center gap-2 rounded-2xl bg-warn-bg px-3 py-1 text-sm text-warn">
                  {CONFIRM[action]}
                  <button type="button" autoFocus className="h-8 rounded-full bg-ink px-3 font-medium text-white" onClick={() => act(action)} disabled={pending}>{label}</button>
                  <button
                    type="button"
                    className="h-8 rounded-full px-2 font-medium text-ink hover:bg-white"
                    onClick={() => { setConfirm(null); requestAnimationFrame(() => document.getElementById(`act-${action}`)?.focus()); }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  key={action}
                  id={`act-${action}`}
                  type="button"
                  disabled={pending || !decision.ok}
                  aria-describedby={decision.ok ? undefined : `why-${action}`}
                  onClick={() => (CONFIRM[action] ? setConfirm(action) : act(action))}
                  className={`h-9 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed ${
                    action === "request_changes" || action === "reject" || action === "withdraw" || action === "retire"
                      ? "border border-line-strong bg-white text-ink hover:bg-paper disabled:text-muted"
                      : "bg-accent text-white hover:bg-accent/90 disabled:bg-line disabled:text-muted"
                  }`}
                >
                  {label}
                </button>
              ),
            )}
            {p.revise && (
              <>
                <button type="button" disabled={pending} onClick={() => revise("minor")} className="h-9 rounded-full bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90">
                  Start revision {p.revise.minor}
                </button>
                <button type="button" disabled={pending} onClick={() => revise("major")} className="h-9 rounded-full border border-line-strong bg-white px-3 text-sm font-medium hover:bg-paper">
                  Start major revision {p.revise.major}
                </button>
              </>
            )}
            <span className="text-sm text-muted" aria-live="polite">
              {pending ? "Working…" : saved && !dirty ? `Saved at ${saved}` : dirty ? "Unsaved changes" : ""}
            </span>
          </div>
          {available.filter((a) => !a.decision.ok).map(({ action, decision }) =>
            decision.ok ? null : (
              <p key={action} id={`why-${action}`} className="mt-2 text-sm text-warn">
                {decision.reason}
                {decision.code === "critical_comments_open" && ` ${criticalHint}`}
              </p>
            ),
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-md bg-del-bg px-3 py-2 text-sm text-del">
              {error}
            </p>
          )}
        </section>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Document */}
        <section aria-label="Document" className="min-w-0">
          <div role="tablist" aria-label="View" className="no-print mb-3 flex flex-wrap gap-x-1 border-b border-line">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                id={`tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls="doc-panel"
                tabIndex={view === v.id ? 0 : -1}
                onClick={() => setView(v.id)}
                onKeyDown={(e) => {
                  const i = VIEWS.findIndex((x) => x.id === view);
                  const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!step) return;
                  const next = VIEWS[(i + step + VIEWS.length) % VIEWS.length].id;
                  setView(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  view === v.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {v.label}
                {v.id === "changes" && changes.length > 0 && (
                  <span className="ms-1.5 rounded-full bg-paper px-1.5 text-xs tabular-nums ring-1 ring-line">
                    <span className="sr-only">(</span>{changes.length}<span className="sr-only">)</span>
                  </span>
                )}
              </button>
            ))}
          </div>

          <div id="doc-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="rounded-lg border border-line bg-surface p-4 sm:p-8">
            {view === "markup" &&
              (p.editable ? (
                <ClauseEditor
                  initial={p.version.content}
                  author={p.me.id}
                  names={p.names}
                  dir={dir}
                  onChange={(d) => { setContent(d); setDirty(true); }}
                  onClause={setFocusClause}
                />
              ) : (
                <div className="doc" dir={dir} lang={lang}><DocRender doc={content} names={p.names} focusClause={focusClause} /></div>
              ))}

            {view === "changes" &&
              (changes.length === 0 ? (
                <p className="text-sm text-muted">No proposed changes in this version.</p>
              ) : (
                <ol className="space-y-3" dir="ltr" lang="en">
                  {changes.map((c, i) => (
                    <li key={i} className="rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className={`font-semibold ${c.kind === "insertion" ? "text-ins" : "text-del"}`}>{c.kind === "insertion" ? "Added" : "Removed"}</span>
                        {c.clause && (
                          <button type="button" onClick={() => jumpTo(c.clause!)} className="font-medium text-accent underline underline-offset-2">
                            clause {nums.get(c.clause) ?? "?"}
                          </button>
                        )}
                        <span className="text-muted">by {p.names[c.author] ?? c.author}{c.at && `, ${when(c.at)}`}</span>
                      </div>
                      <p className="doc mt-1" dir="auto">
                        {c.kind === "insertion" ? <ins>{c.text}</ins> : <del>{c.text}</del>}
                      </p>
                    </li>
                  ))}
                </ol>
              ))}

            {view === "clean" && <div className="doc" dir={dir} lang={lang}><DocRender doc={cleanView(content)} /></div>}

            {view === "compare" && (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="min-w-0">
                  <h2 className="mb-2 text-sm font-semibold text-muted">{p.previousLabel ? `Version ${p.previousLabel} (active)` : "Before changes"}</h2>
                  <div className="doc" dir={dir} lang={lang}><DocRender doc={p.previousContent ?? originalView(content)} /></div>
                </div>
                <div className="min-w-0 md:border-s md:border-line md:ps-6">
                  <h2 className="mb-2 text-sm font-semibold text-muted">Version {p.version.label}, changes accepted</h2>
                  <div className="doc" dir={dir} lang={lang}><DocRender doc={cleanView(content)} /></div>
                </div>
              </div>
            )}
          </div>
        </section>

        <Comments {...p} nums={nums} focusClause={focusClause} jumpTo={jumpTo} />
      </div>
    </div>
  );
}

function Comments(p: Props & { nums: Map<string, string>; focusClause: string | null; jumpTo: (id: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [critical, setCritical] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const effectiveTarget = target || p.focusClause || "";
  const threads = p.comments.filter((c) => !c.parent_id);
  const open = threads.filter((t) => !t.resolved_at).sort((a, b) => Number(b.critical) - Number(a.critical));
  const done = threads.filter((t) => t.resolved_at);
  const replies = (id: string) => p.comments.filter((c) => c.parent_id === id);

  const submit = (input: Parameters<typeof commentAction>[2], after: () => void) =>
    start(async () => {
      const r = await commentAction(p.doc.id, p.version.id, input);
      if (r.ok) { setError(null); after(); router.refresh(); } else setError(r.error);
    });

  const canResolve = (c: Comment) =>
    p.me.roles.includes("admin") || p.me.id === c.author_id || (!c.critical && p.version.authorId === p.me.id);

  // A render function, not a component: a component defined here would remount
  // on every keystroke and reset the reply box.
  const thread = (c: Comment) => (
    <li key={c.id} className={`rounded-lg border bg-white p-3 ${c.critical && !c.resolved_at ? "border-del/40" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {c.critical && (
          <span className={`rounded-full px-2 py-0.5 font-semibold ${c.resolved_at ? "bg-paper text-muted" : "bg-del-bg text-del"}`}>Critical</span>
        )}
        {c.clause_id && (
          <button type="button" onClick={() => p.jumpTo(c.clause_id!)} className="font-medium text-accent underline underline-offset-2">
            {p.nums.has(c.clause_id) ? `Clause ${p.nums.get(c.clause_id)}` : "Deleted clause"}
          </button>
        )}
        <span className="text-muted">{c.author_name} · {when(c.created_at)}</span>
      </div>
      <p className="mt-1.5 text-sm" dir="auto">{c.body}</p>
      {replies(c.id).map((r) => (
        <div key={r.id} className="mt-2 border-s-2 border-line ps-3">
          <p className="text-xs text-muted">{r.author_name} · {when(r.created_at)}</p>
          <p className="text-sm" dir="auto">{r.body}</p>
        </div>
      ))}
      {c.resolved_at ? (
        <p className="mt-2 text-xs text-muted">Resolved {when(c.resolved_at)}</p>
      ) : (
        p.canComment && (
          <div className="mt-2 flex flex-wrap gap-2">
            {replying === c.id ? (
              <form
                className="flex w-full flex-col gap-2"
                onSubmit={(e) => { e.preventDefault(); submit({ body: reply, parentId: c.id }, () => { setReply(""); setReplying(null); }); }}
              >
                <label className="sr-only" htmlFor={`reply-${c.id}`}>Reply</label>
                <textarea id={`reply-${c.id}`} autoFocus dir="auto" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} className="w-full rounded-md border border-line-strong p-2 text-sm" />
                <div className="flex gap-2">
                  <button disabled={pending || !reply.trim()} className="h-8 rounded-full bg-accent px-3 text-sm font-medium text-white disabled:bg-line disabled:text-muted">Reply</button>
                  <button type="button" onClick={() => setReplying(null)} className="h-8 rounded-full px-2 text-sm font-medium hover:bg-paper">Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <button type="button" onClick={() => { setReplying(c.id); setReply(""); }} className="h-8 rounded-full px-2 text-sm font-medium text-accent hover:bg-paper">Reply</button>
                {canResolve(c) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => { const r = await resolveAction(p.doc.id, c.id); if (r.ok) router.refresh(); else setError(r.error); })}
                    className="h-8 rounded-full px-2 text-sm font-medium text-ink hover:bg-paper"
                  >
                    Resolve
                  </button>
                )}
              </>
            )}
          </div>
        )
      )}
    </li>
  );

  return (
    <aside aria-label="Comments" className="no-print min-w-0">
      <h2 className="flex items-center justify-between text-sm font-semibold">
        Comments
        {p.criticalOpen > 0 && <span className="rounded-full bg-del-bg px-2 py-0.5 text-xs text-del">{p.criticalOpen} critical open</span>}
      </h2>

      {p.canComment && (
        <form
          className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-white p-3"
          onSubmit={(e) => { e.preventDefault(); submit({ body, clauseId: effectiveTarget || null, critical }, () => { setBody(""); setCritical(false); }); }}
        >
          <label className="text-xs font-medium text-muted" htmlFor="comment-target">On</label>
          <select id="comment-target" value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} className="select h-9 w-full">
            <option value="">The whole document</option>
            {[...p.nums].map(([id, n]) => <option key={id} value={id}>Clause {n}</option>)}
          </select>
          <label className="sr-only" htmlFor="comment-body">Comment</label>
          <textarea id="comment-body" dir="auto" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" className="rounded-md border border-line-strong p-2 text-sm placeholder:text-muted" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-del)]" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
            <span>Critical <span className="text-muted">(blocks approval until resolved)</span></span>
          </label>
          <button disabled={pending || !body.trim()} className="h-9 self-start rounded-full bg-accent px-3 text-sm font-medium text-white disabled:bg-line disabled:text-muted">Comment</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 rounded-md bg-del-bg px-3 py-2 text-sm text-del">{error}</p>}

      <ul className="mt-3 space-y-2">
        {open.map(thread)}
        {open.length === 0 && <li className="text-sm text-muted">No open comments.</li>}
      </ul>
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">{done.length} resolved</summary>
          <ul className="mt-2 space-y-2">{done.map(thread)}</ul>
        </details>
      )}
    </aside>
  );
}
