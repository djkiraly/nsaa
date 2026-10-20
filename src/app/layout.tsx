import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NSAA Volleyball Postseason Agent",
  description: "Seedings, brackets and simulations for Nebraska high school volleyball districts and state.",
};

const nav = [
  { href: "/", label: "Overview" },
  { href: "/class/B", label: "Class B" },
  { href: "/class/C2", label: "Class C2" },
  { href: "/chat", label: "Ask the agent" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="text-accent">NSAA</span> Volleyball Postseason
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="px-3 py-1.5 rounded-md hover:bg-muted-bg">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-border text-xs text-muted">
          <div className="mx-auto max-w-6xl px-4 py-3">
            Data: NSAA wildcard exports (nsaahome.org). Projections use the 2026 Volleyball Manual rules; probabilities are
            model estimates, not official NSAA information.
          </div>
        </footer>
      </body>
    </html>
  );
}
