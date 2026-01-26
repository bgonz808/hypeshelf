export function CardSkeleton() {
  return (
    <div
      className="bg-surface border-muted animate-pulse rounded-lg border p-4"
      aria-hidden="true"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="bg-skeleton h-5 w-16 rounded-full" />
        <div className="bg-skeleton h-4 w-12 rounded-sm" />
      </div>

      {/* Title */}
      <div className="bg-skeleton mb-2 h-6 w-3/4 rounded-sm" />

      {/* Blurb lines */}
      <div className="mb-4 space-y-2">
        <div className="bg-skeleton h-4 w-full rounded-sm" />
        <div className="bg-skeleton h-4 w-5/6 rounded-sm" />
      </div>

      {/* Footer */}
      <div className="border-muted flex items-center justify-between border-t pt-3">
        <div className="bg-skeleton h-4 w-24 rounded-sm" />
        <div className="bg-skeleton h-8 w-16 rounded-full" />
      </div>
    </div>
  );
}
