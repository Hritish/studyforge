import { CreateFlow } from "@/components/create/CreateFlow";
import { engineMode } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const metadata = { title: "New study set · StudyForge" };

export default function NewSetPage() {
  return <CreateFlow engine={engineMode()} />;
}
