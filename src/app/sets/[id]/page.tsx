import { notFound } from "next/navigation";
import { SetOverview } from "@/components/SetOverview";
import { getSetWithCards, serializeCard } from "@/lib/sets";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) notFound();
  return (
    <SetOverview
      set={{ id: set.id, title: set.title, context: set.context, bestMatchMs: set.bestMatchMs, cards: set.cards.map(serializeCard) }}
    />
  );
}
