import type { Metadata } from "next";
import { Lexend, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { session } from "@/lib/session";
import "./globals.css";

const ui = Lexend({ variable: "--font-ui", subsets: ["latin"] });
const head = Plus_Jakarta_Sans({ variable: "--font-head", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: { default: "Clause", template: "%s · Clause" },
  description: "Policies, SOPs and contracts with numbered clauses, review, approval and versions. English and Dhivehi.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { users, me } = await session();
  return (
    <html lang="en" className={`${ui.variable} ${head.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="no-print border-b border-line bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2 font-semibold">
              <span className="font-display text-xl font-bold">Clause</span>
              <span className="text-sm font-normal text-muted max-sm:hidden">policies, SOPs and contracts</span>
            </Link>
            <RoleSwitcher users={users} current={me.id} />
          </div>
          <p className="bg-ink px-4 py-2 text-center text-sm text-white">
            Demo. Switch role above to walk a document through review, approval and publishing.
          </p>
        </header>
        <main id="main" className="flex-1">{children}</main>
        {/* Outlives page remounts, so status changes are announced after a workflow step. */}
        <div id="live" role="status" aria-live="polite" className="sr-only" />
        <footer className="no-print mt-12 bg-ink text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm">
            <p>
              <span className="font-semibold text-coral">Clause</span> · a working demo by Mohamed Shiwan.
            </p>
            <p className="text-white/80">Sample data only.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
