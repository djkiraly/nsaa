"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cn } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string; input: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "Show me the projected Class B districts and who hosts each final.",
  "Who is Gering most likely to face in the district final, and what are their odds?",
  "Which C2 teams are most likely to take the six district-final wildcard spots?",
  "Who's favored to win Class A, and who gets the state wildcard?",
  "How are the D1 sub-districts formed, and who's favored in D1-9?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }, { role: "assistant", content: "", tools: [] }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          setMessages((cur) => {
            const copy = [...cur];
            const last = { ...copy[copy.length - 1] };
            if (ev.type === "text") last.content += ev.delta;
            if (ev.type === "tool") last.tools = [...(last.tools ?? []), { name: ev.name, input: ev.input }];
            if (ev.type === "error") setError(ev.message);
            copy[copy.length - 1] = last;
            return copy;
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Phones: no fixed-height box (100vh ignores the browser toolbars) — the page scrolls and the input stays
    // pinned to the bottom of the screen instead.
    <div className="flex flex-col h-[calc(100vh-10rem)] max-md:h-auto max-md:min-h-[calc(100dvh-12rem)]">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 max-md:overflow-visible max-md:pr-0">
        {messages.length === 0 && (
          <div className="text-sm text-muted space-y-3 max-w-2xl">
            <p>
              Ask about any class (A, B, C1, C2, D1, D2): seedings, projected brackets, likely matchups, host sites, or simulation odds. The
              agent pulls from the current NSAA wildcard data and runs the rules from the 2026 manual.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-xs rounded-md border border-border bg-card px-3 py-2 hover:bg-muted-bg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap max-md:max-w-[92%] max-md:px-3 max-md:[overflow-wrap:anywhere]",
                m.role === "user" ? "bg-foreground text-background" : "bg-card border border-border",
              )}
            >
              {m.tools && m.tools.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span key={j} className="text-[11px] rounded bg-muted-bg px-1.5 py-0.5 text-muted font-mono">
                      {t.name}
                      {t.input && Object.keys(t.input).length ? `(${Object.values(t.input).join(", ")})` : ""}
                    </span>
                  ))}
                </div>
              )}
              {m.content || (busy && i === messages.length - 1 ? <span className="text-muted">thinking…</span> : "")}
            </div>
          </div>
        ))}
        {error && <div className="text-sm text-accent">Error: {error}</div>}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:px-4 max-md:py-3 max-md:bg-background max-md:border-t max-md:border-border"
      >
        {/* text-base on phones: iOS Safari zooms the page when focusing an input under 16px. */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about seedings, brackets, matchups, sites…"
          enterKeyHint="send"
          className="flex-1 h-10 rounded-md border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-accent/30 max-md:min-w-0 max-md:h-11 max-md:text-base"
        />
        <Button type="submit" disabled={busy || !input.trim()} className="max-md:h-11 max-md:px-4">
          Send
        </Button>
      </form>
    </div>
  );
}
