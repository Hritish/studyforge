import { notFound } from "next/navigation";
import { LearnMode } from "@/components/study/LearnMode";
import { StudyShell } from "@/components/study/StudyShell";
import { getSetWithCards, serializeCard } from "@/lib/sets";

export const dynamic = "force-dynamic";

export default async function LearnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) notFound();
  return (
    <StudyShell setId={set.id} title={set.title} contextName={set.context.name} mode="learn">
      <LearnMode setId={set.id} cards={set.cards.map(serializeCard)} bestMatchMs={set.bestMatchMs} />
    </StudyShell>
  );
}
