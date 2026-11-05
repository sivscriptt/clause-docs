import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocRender } from "@/components/DocRender";
import { PrintButton } from "@/components/PrintButton";
import { stateLabel } from "@/components/StateBadge";
import { cache } from "react";
import { ServiceError } from "@/lib/errors";
import { cleanView } from "@/lib/doc/views";
import * as svc from "@/lib/service";
import { session } from "@/lib/session";

const load = cache(async (id: string, v?: string) => {
  try {
    const { db, me } = await session();
    const doc = await svc.getDocument(db, me, id);
    const version = doc.versions.find((x) => x.id === v) ?? doc.versions.find((x) => x.state === "active") ?? doc.versions[0];
    return { doc, version };
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({ params, searchParams }: PageProps<"/docs/[id]/read">): Promise<Metadata> {
  const v = (await searchParams).v;
  const { doc } = await load((await params).id, typeof v === "string" ? v : undefined);
  return { title: doc.metadata.title };
}

/** Clean text for reading and printing. Print to PDF from the browser; the Thaana font is embedded. */
export default async function ReadPage({ params, searchParams }: PageProps<"/docs/[id]/read">) {
  const { id } = await params;
  const v = (await searchParams).v;
  const { doc, version } = await load(id, typeof v === "string" ? v : undefined);
  const dir = doc.metadata.dir;
  const effective = version.activated_at
    ? version.activated_at.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Indian/Maldives" })
    : null;

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0" dir={dir} lang={dir === "rtl" ? "dv" : "en"}>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3" dir="ltr" lang="en">
        <Link href={`/docs/${id}?v=${version.id}`} className="text-sm text-muted hover:text-ink hover:underline">
          ← Back to editing and comments
        </Link>
        <PrintButton />
      </div>
      <header className="border-b border-line-strong pb-4">
        <h1 className="text-3xl font-semibold text-balance">{doc.metadata.title}</h1>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted" dir="ltr" lang="en">
          <div className="flex gap-1"><dt>Version</dt><dd className="font-medium text-ink tabular-nums">{version.major}.{version.minor}</dd></div>
          <div className="flex gap-1"><dt>Status</dt><dd className="font-medium text-ink">{stateLabel(version.state)}</dd></div>
          {effective && <div className="flex gap-1"><dt>Effective</dt><dd className="font-medium text-ink">{effective}</dd></div>}
          <div className="flex gap-1"><dt>Owner</dt><dd className="font-medium text-ink">{doc.metadata.owner}</dd></div>
          <div className="flex gap-1"><dt>Review every</dt><dd className="font-medium text-ink">{doc.metadata.reviewCycleMonths} months</dd></div>
        </dl>
        {version.state !== "active" && (
          <p className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn" dir="ltr" lang="en">
            This is not the active version. Proposed changes are shown accepted.
          </p>
        )}
      </header>
      <div className="doc mt-6">
        <DocRender doc={cleanView(version.content)} />
      </div>
    </article>
  );
}
