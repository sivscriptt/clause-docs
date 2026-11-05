import Link from "next/link";
import { notFound } from "next/navigation";
import { StateBadge } from "@/components/StateBadge";
import { ServiceError } from "@/lib/errors";
import * as svc from "@/lib/service";
import { session } from "@/lib/session";

export const metadata = { title: "History" };

const ACTION: Record<string, string> = {
  create: "Created the document",
  edit: "Edited the text",
  edit_metadata: "Changed document details",
  submit: "Submitted for review",
  request_changes: "Requested changes",
  send_for_approval: "Sent for approval",
  reject: "Rejected",
  approve: "Approved",
  activate: "Made active",
  supersede: "Superseded",
  withdraw: "Withdrew",
  retire: "Retired",
  revise: "Started a revision",
  comment: "Commented",
  resolve_comment: "Resolved a comment",
};

export default async function HistoryPage({ params }: PageProps<"/docs/[id]/history">) {
  const { id } = await params;
  let data;
  try {
    const { db, me } = await session();
    const doc = await svc.getDocument(db, me, id);
    data = { doc, trail: await svc.auditTrail(db, me, id) };
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    if (e instanceof ServiceError && e.status === 403)
      return (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <h1 className="text-2xl font-semibold">History</h1>
          <p className="mt-2 text-sm text-muted">{e.message} Switch to a reviewer, approver or admin to see it.</p>
        </div>
      );
    throw e;
  }
  const { doc, trail } = data;
  const label = (vid: string) => {
    const v = doc.versions.find((x) => x.id === vid);
    return v ? `${v.major}.${v.minor}` : null;
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href={`/docs/${id}`} className="text-sm text-muted hover:text-ink hover:underline">← <bdi>{doc.metadata.title}</bdi></Link>
      <h1 className="mt-1 text-2xl font-semibold">History</h1>

      <h2 className="mt-6 text-sm font-semibold">Versions</h2>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
        {doc.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <Link href={`/docs/${id}?v=${v.id}`} className="font-medium tabular-nums text-accent underline underline-offset-2">{v.major}.{v.minor}</Link>
            <StateBadge state={v.state} />
            <span className="text-muted">by {v.author_name}</span>
            {v.activated_at && <span className="text-muted">active from {v.activated_at.toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Indian/Maldives" })}</span>}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-semibold">Audit log</h2>
      <p className="mt-1 text-sm text-muted">Append-only. The database refuses edits and deletes on this table.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-start text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 text-start font-medium">When</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">Who</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">What</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {trail.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted">
                  {a.at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Indian/Maldives" })}
                </td>
                <td className="whitespace-nowrap px-4 py-2">{a.actor_name}</td>
                <td className="px-4 py-2">
                  {ACTION[a.action] ?? a.action}
                  {a.entity === "version" && label(a.entity_id) && <span className="text-muted"> · version {label(a.entity_id)}</span>}
                  {typeof a.data?.version === "string" && <span className="text-muted"> · version {a.data.version}</span>}
                  {a.data?.critical === true && <span className="ms-1 rounded bg-del-bg px-1 text-xs text-del">critical</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
