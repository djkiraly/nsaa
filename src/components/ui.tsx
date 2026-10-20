/**
 * Minimal shadcn-style primitives (no registry access at build time).
 * Replace with `npx shadcn add card badge button table` whenever you like —
 * the class names are compatible.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card shadow-sm", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pt-4 pb-2", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...p} />;
}

export function Badge({
  className,
  variant = "default",
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "accent" | "good" | "outline" }) {
  const v = {
    default: "bg-muted-bg text-foreground",
    accent: "bg-accent-soft text-accent",
    good: "bg-good-soft text-good",
    outline: "border border-border text-muted",
  }[variant];
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", v, className)} {...p} />;
}

export function Button({
  className,
  variant = "default",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" }) {
  const v = {
    default: "bg-foreground text-background hover:opacity-90",
    outline: "border border-border bg-card hover:bg-muted-bg",
    ghost: "hover:bg-muted-bg",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 h-9 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        v,
        className,
      )}
      {...p}
    />
  );
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...p} />
    </div>
  );
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("text-left font-medium text-muted px-2 py-1.5 border-b border-border whitespace-nowrap", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-2 py-1.5 border-b border-border/60 align-top", className)} {...p} />;
}

/** Compact labelled probability (phone layouts): label, number, thin bar underneath. */
export function ProbStat({ label, value }: { label: string; value: number }) {
  const p = Math.max(0, Math.min(1, value));
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-tight text-muted truncate">{label}</div>
      <div className="tabular text-sm font-medium leading-snug">{(p * 100).toFixed(0)}%</div>
      <div className="mt-0.5 h-1 rounded bg-muted-bg overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

/** Probability as a subtle bar + number. */
export function Prob({ value }: { value: number }) {
  const p = Math.max(0, Math.min(1, value));
  return (
    <span className="inline-flex items-center gap-2 tabular">
      <span className="h-1.5 w-16 rounded bg-muted-bg overflow-hidden">
        <span className="block h-full bg-accent" style={{ width: `${p * 100}%` }} />
      </span>
      <span className="w-10 text-right">{(p * 100).toFixed(0)}%</span>
    </span>
  );
}
