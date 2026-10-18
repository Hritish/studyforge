import { notFound } from "next/navigation";
import { MatchMode } from "@/components/study/MatchMode";
import { StudyShell } from "@/components/study/StudyShell";
import { getSetWithCards, serializeCard } from "@/lib/sets";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) notFound();
  return (
    <StudyShell setId={set.id} title={set.title} contextName={set.context.name} mode="match">
      <MatchMode setId={set.id} cards={set.cards.map(serializeCard)} bestMatchMs={set.bestMatchMs} />
    </StudyShell>
  );
}
