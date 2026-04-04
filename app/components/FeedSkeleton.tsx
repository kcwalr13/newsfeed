export default function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="w-full bg-white border border-gray-200 rounded-lg p-4 animate-pulse"
        >
          <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-full bg-gray-200 rounded mb-1" />
          <div className="h-4 w-3/4 bg-gray-200 rounded mb-3" />
          <div className="h-3 w-full bg-gray-100 rounded mb-1" />
          <div className="h-3 w-2/3 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}
