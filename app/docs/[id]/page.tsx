import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { can } from "@/lib/auth";
import { cache } from "react";
import { ServiceError } from "@/lib/errors";
import { metadataErrors } from "@/lib/doc/metadata";
import { actionsFrom, decide, RULES } from "@/lib/lifecycle/machine";
import { formatVersion, nextVersion } from "@/lib/lifecycle/version";
import * as svc from "@/lib/service";
import { session } from "@/lib/session";

const OPEN = ["draft", "in_review", "changes_requested", "pending_approval", "approved"];

/** Cached per request, so the page and its metadata share one load. */
const load = cache(async (id: string, v?: string) => {
  const { db, me, users } = await session();
  const doc = await svc.getDocument(db, me, id);
  const version = doc.versions.find((x) => x.id === v) ?? doc.versions.find((x) => OPEN.includes(x.state)) ?? doc.versions.find((x) => x.state === "active") ?? doc.versions[0];
  const comments = await svc.listComments(db, version.id);
  const critical = comments.filter((c) => c.critical && !c.parent_id && !c.resolved_at).length;
  const errors = metadataErrors(doc.metadata);
  const actions = actionsFrom(version.state).map((action) => ({
    action,
    label: RULES[action].label,
    decision: decide({ action, state: version.state, actor: me, authorId: version.author_id, openCriticalComments: critical, metadataErrors: errors }),
  }));
  const hasOpen = doc.versions.some((x) => OPEN.includes(x.state));
  const active = doc.versions.find((x) => x.state === "active");
  const latest = doc.versions[0];
  const revise =
    can.edit(me) && !hasOpen && active
      ? { minor: formatVersion(nextVersion(latest, "minor")), major: formatVersion(nextVersion(latest, "major")) }
      : null;
  return { me, doc, version, comments, critical, users, actions, revise, previous: active && active.id !== version.id ? active : null };
});

const versionParam = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export async function generateMetadata({ params, searchParams }: PageProps<"/docs/[id]">): Promise<Metadata> {
  try {
    const { doc } = await load((await params).id, versionParam((await searchParams).v));
    return { title: doc.metadata.title };
  } catch {
    return { title: "Not found" };
  }
}

export default async function DocPage({ params, searchParams }: PageProps<"/docs/[id]">) {
  const { id } = await params;
  const v = (await searchParams).v;
  let data;
  try {
    data = await load(id, versionParam(v));
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const { me, doc, version, comments, critical, users, actions, revise, previous } = data;
  const editable = can.edit(me) && ["draft", "changes_requested"].includes(version.state);

  return (
    <Workspace
      key={`${version.id}:${version.state}`}
      me={me}
      doc={{ id: doc.id, metadata: doc.metadata }}
      versions={doc.versions.map((x) => ({ id: x.id, label: `${x.major}.${x.minor}`, state: x.state }))}
      version={{
        id: version.id,
        label: `${version.major}.${version.minor}`,
        state: version.state,
        content: version.content,
        author: version.author_name,
        authorId: version.author_id,
        updatedAt: version.updated_at.toISOString(),
      }}
      previousContent={previous?.content ?? null}
      previousLabel={previous ? `${previous.major}.${previous.minor}` : null}
      editable={editable}
      canComment={can.comment(me) && OPEN.includes(version.state)}
      canSeeHistory={can.readAudit(me)}
      comments={comments.map((c) => ({ ...c, created_at: c.created_at.toISOString(), resolved_at: c.resolved_at?.toISOString() ?? null }))}
      criticalOpen={critical}
      actions={actions}
      revise={revise}
      names={Object.fromEntries(users.map((u) => [u.id, u.name]))}
    />
  );
}
