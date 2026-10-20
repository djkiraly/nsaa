/** Shown instantly on navigation while a page that isn't prefetched yet is on its way. */
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-64 max-w-full rounded bg-muted-bg" />
        <div className="h-4 w-96 max-w-full rounded bg-muted-bg" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-56 rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
