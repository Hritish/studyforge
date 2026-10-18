import { notFound } from "next/navigation";
import { CreateFlow } from "@/components/create/CreateFlow";
import { engineMode } from "@/lib/engine";
import { getSetWithCards } from "@/lib/sets";

export const dynamic = "force-dynamic";

export default async function AddNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) notFound();
  return <CreateFlow engine={engineMode()} setId={set.id} setTitle={set.title} initialContext={set.context} />;
}
