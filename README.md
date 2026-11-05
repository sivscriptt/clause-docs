# Clause

A working demo of a document system for policies, SOPs, standards, manuals and contracts, in English and Dhivehi. I built it to get the hard parts running for real: clause numbering, cross-references, track changes, and a review and approval flow with an audit trail.

**Live demo:** https://clause-docs.mhd-shiwan.workers.dev. Pick a person in the top bar to switch roles (author, reviewer, approver, reader, admin). No sign-up.

## What works

- **Numbered clauses.** 1, 1.1, 1.1.1. Numbers aren't stored. They come from where a clause sits in the tree, so moving, indenting or deleting a clause renumbers everything after it.
- **Cross-references.** A reference points at a clause's id, not its number. Move the clause and the reference follows. Delete it and the reference is flagged as broken.
- **Dhivehi.** Right-to-left documents, per-paragraph direction for mixed text, and Thaana search. Thaana uses Faruma when it's available (installed, or served by the live demo); a fresh clone falls back to the bundled Noto Sans Thaana (OFL), since Faruma is all-rights-reserved and isn't in this repo.
- **Track changes.** With tracking on, typed text is marked as added and deleted text is struck through instead of disappearing, each with author and time.
- **Four views.** Full markup, a list of proposed changes, the clean revised text, and side by side against the active version.
- **Comments.** Threaded, attached to a clause. A critical comment blocks approval until the person who raised it resolves it.
- **Lifecycle.** Draft → In review → Changes requested → Awaiting approval → Approved → Active → Superseded / Retired. Every transition goes through one function (`decide` in `lib/lifecycle/machine.ts`) that checks state, role, separation of duties (nobody approves their own text), open critical comments and metadata. The buttons, the API and the database transaction all use it.
- **Versions.** Minor (1.1 → 1.2) or major (1.2 → 2.0) revisions. Activating a version supersedes the old one in the same transaction, and a partial unique index guarantees there's never more than one active version.
- **Audit log.** Append-only. A trigger refuses UPDATE, DELETE and TRUNCATE on the table, so history can't be changed from the app.
- **Reading view and PDF.** Clean text with print styles; print or save as PDF from the browser.
- **REST API** with an OpenAPI 3.1 spec at `/api/v1/openapi.json`.

The 100-page sample manual (53k words, 280 clauses) opens in the editor in about 150 ms on a normal Node server, and typing stays at one frame per keystroke. On the hosted Workers demo it takes about a second, most of it Worker cold start.

## Stack

Next.js 16 (App Router), TypeScript, TipTap 3, Tailwind 4 with logical properties, Postgres via `pg`, Vitest. Hosted on Cloudflare Workers with Neon Postgres.

## Run it

```bash
npm install
createdb clause_docs
export DATABASE_URL=postgres://localhost/clause_docs
npm run db:reset      # schema + sample documents
npm run dev
```

Put `DATABASE_URL` in `.env.local` for the dev server.

## Tests

```bash
TEST_DATABASE_URL=postgres://localhost/clause_test npm test
```

- `tests/numbering.test.ts`: numbering, move, indent, outdent and delete, plus cross-references following or breaking.
- `tests/lifecycle.test.ts`: every action × state × role combination, and every guard.
- `tests/views.test.ts`: the clean, original and changes views.
- `tests/service.test.ts`: against real Postgres. The full review-to-active flow, rollbacks, two approvers racing on the same version, the one-active-version index, the append-only audit log, permissions and Thaana search.

Without `TEST_DATABASE_URL` the database tests are skipped.

## Layout

```
lib/doc/         document tree, numbering, cross-references, tracked-change views, metadata rules
lib/lifecycle/   state machine and version numbers
lib/service.ts   everything that touches the database, one transaction per operation
components/      editor (TipTap extensions), workspace, comments
app/api/v1/      REST endpoints
db/              migrations and sample data
```

## What the demo leaves out

Sign-in uses a role switcher instead of OIDC (`lib/session.ts` is the seam). Email notifications and file attachments aren't wired up yet. Structural edits (moving or adding clauses) aren't tracked as changes; text edits are.
