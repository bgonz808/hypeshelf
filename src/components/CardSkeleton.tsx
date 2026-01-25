export function CardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-lg border border-gray-200 bg-white p-4"
      aria-hidden="true"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="h-5 w-16 rounded-full bg-gray-200" />
        <div className="h-4 w-12 rounded-sm bg-gray-200" />
      </div>

      {/* Title */}
      <div className="mb-2 h-6 w-3/4 rounded-sm bg-gray-200" />

      {/* Blurb lines */}
      <div className="mb-4 space-y-2">
        <div className="h-4 w-full rounded-sm bg-gray-200" />
        <div className="h-4 w-5/6 rounded-sm bg-gray-200" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="h-4 w-24 rounded-sm bg-gray-200" />
        <div className="h-8 w-16 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}
