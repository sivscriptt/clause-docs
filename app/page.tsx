import Link from "next/link";
import { StateBadge } from "@/components/StateBadge";
import { listDocuments } from "@/lib/service";
import { session } from "@/lib/session";

const CATEGORY: Record<string, string> = { policy: "Policy", sop: "SOP", standard: "Standard", manual: "Manual", contract: "Contract" };

export default async function Home({ searchParams }: PageProps<"/">) {
  const q = String((await searchParams).q ?? "").slice(0, 200);
  const { db, me } = await session();
  const docs = await listDocuments(db, me, q);
  const readerOnly = me.roles.every((r) => r === "reader");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="mt-1 text-sm text-muted">
        {readerOnly ? "You see the active version of each document." : "Active documents and any revision in progress."}
      </p>

      <form role="search" className="mt-6 flex gap-2" action="/">
        <label htmlFor="q" className="sr-only">Search documents</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          dir="auto"
          placeholder="Search in English or ދިވެހި"
          className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-white px-3 text-base placeholder:text-muted"
        />
        <button className="h-10 rounded-full bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90">Search</button>
      </form>

      {q && (
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          {docs.length === 0 ? (
            <>No documents mention “<bdi>{q}</bdi>”. Try fewer words, or <Link className="text-accent underline" href="/">see all documents</Link>.</>
          ) : (
            <>{docs.length} {docs.length === 1 ? "document mentions" : "documents mention"} “<bdi>{q}</bdi>”. <Link className="text-accent underline" href="/">Clear search</Link></>
          )}
        </p>
      )}

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {docs.map((d) => (
          <li key={d.id}>
            <Link href={`/docs/${d.id}`} className="block px-4 py-3 hover:bg-paper focus-visible:bg-paper">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium" dir="auto">{d.metadata.title}</span>
                <StateBadge state={d.state} />
              </div>
              <div className="mt-1 text-sm text-muted">
                {CATEGORY[d.metadata.category] ?? d.metadata.category} · {d.metadata.owner} · version {d.major}.{d.minor}
              </div>
              {d.snippet && (
                <p className="mt-1.5 line-clamp-2 text-sm" dir="auto">
                  …{d.snippet}…
                </p>
              )}
            </Link>
          </li>
        ))}
        {!q && docs.length === 0 && <li className="px-4 py-6 text-sm text-muted">No documents yet.</li>}
      </ul>
    </div>
  );
}
