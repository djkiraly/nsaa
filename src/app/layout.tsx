import type { Metadata } from "next";
import Link from "next/link";
import { CLASS_ORDER } from "@/lib/engine/types";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

/** Runs before first paint: apply the saved theme (header toggle), else the system one, and follow system changes. */
const THEME_SCRIPT = `(function(){try{
var d=document.documentElement,s=localStorage.getItem("theme"),m=matchMedia("(prefers-color-scheme: dark)");
d.dataset.theme=s==="light"||s==="dark"?s:m.matches?"dark":"light";
m.addEventListener("change",function(e){if(!localStorage.getItem("theme"))d.dataset.theme=e.matches?"dark":"light"});
}catch(e){}})()`;

export const metadata: Metadata = {
  title: "NSAA Volleyball Postseason Agent",
  description: "Seedings, brackets and simulations for Nebraska high school volleyball districts and state.",
};

// `short` is the phone label: all eight links have to fit across a ~360px screen.
const nav = [
  { href: "/", label: "Overview", short: "Overview" },
  ...CLASS_ORDER.map((c) => ({ href: `/class/${c}`, label: `Class ${c}`, short: c })),
  { href: "/chat", label: "Ask the agent", short: "Chat" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme on <html> before React hydrates.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Phones: sticky, brand + theme toggle on one row and the nav (short labels) spread across the next. */}
        <header className="border-b border-border bg-card max-md:sticky max-md:top-0 max-md:z-20">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4 max-md:h-auto max-md:flex-col max-md:items-stretch max-md:gap-1 max-md:pt-2 max-md:pb-1.5">
            <div className="flex items-center justify-between gap-2">
              <Link href="/" className="font-semibold tracking-tight max-md:whitespace-nowrap">
                <span className="text-accent">NSAA</span> Volleyball Postseason
              </Link>
              <ThemeToggle className="md:hidden -mr-1.5" />
            </div>
            <div className="flex items-center gap-1">
              <nav className="flex items-center gap-0.5 text-sm overflow-x-auto whitespace-nowrap max-md:flex-1 max-md:justify-between max-md:-mx-2">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="px-2.5 py-1.5 rounded-md hover:bg-muted-bg max-md:px-2 max-md:py-2">
                    <span className="md:hidden">{n.short}</span>
                    <span className="max-md:hidden">{n.label}</span>
                  </Link>
                ))}
              </nav>
              <ThemeToggle className="max-md:hidden" />
            </div>
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
