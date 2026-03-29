"use client";

import { useRouter } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";
import Screen2ClassifyNotes from "@/components/Screen2ClassifyNotes";
import { api } from "@/lib/api";

export default function AdminClassifyPage() {
  const router = useRouter();
  const ctx = useAppContext();

  const handleClassified = async () => {
    const state = await api.sessionState();
    ctx.setNoteMeta(state.note_meta ?? {});
    if (ctx.portfolioNames.length > 0) {
      ctx.loadPrecalc();
    }
    router.push("/admin/portfolio-builder");
  };

  return (
    <Screen2ClassifyNotes
      noteIds={ctx.noteIds}
      noteSuggestions={ctx.noteSuggestions}
      onContinue={handleClassified}
    />
  );
}
