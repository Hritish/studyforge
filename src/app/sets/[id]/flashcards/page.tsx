import { notFound } from "next/navigation";
import { FlashcardsMode } from "@/components/study/FlashcardsMode";
import { StudyShell } from "@/components/study/StudyShell";
import { getSetWithCards, serializeCard } from "@/lib/sets";

export const dynamic = "force-dynamic";

export default async function FlashcardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) notFound();
  return (
    <StudyShell setId={set.id} title={set.title} contextName={set.context.name} mode="flashcards">
      <FlashcardsMode setId={set.id} cards={set.cards.map(serializeCard)} bestMatchMs={set.bestMatchMs} />
    </StudyShell>
  );
}
