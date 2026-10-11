import { CharacterGridSkeleton } from "@/components/characters/character-card";
import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-8 h-4 w-40" />
      <CharacterGridSkeleton />
    </div>
  );
}
