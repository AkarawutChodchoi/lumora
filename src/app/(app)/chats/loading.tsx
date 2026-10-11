import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="mb-6 h-8 w-32" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
