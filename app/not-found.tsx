import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Document not found</h1>
      <p className="mt-2 text-muted">
        It may have been retired, or your role can’t see it. Readers only see active documents.
      </p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90">
        See all documents
      </Link>
    </div>
  );
}
