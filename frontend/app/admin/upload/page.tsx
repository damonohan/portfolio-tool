"use client";

import { useRouter } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";
import Screen1Upload from "@/components/Screen1Upload";
import { api, NoteMeta } from "@/lib/api";

export default function AdminUploadPage() {
  const router = useRouter();
  const ctx = useAppContext();

  const handleUpload = (data: {
    assetCols: string[];
    noteIds: string[];
    restoredPortfolios: number;
    restoredNoteMeta: boolean;
    restoredAssetMeta: boolean;
    noteSuggestions: Record<string, NoteMeta>;
    autoClassified: boolean;
  }) => {
    ctx.setAssetCols(data.assetCols);
    ctx.setNoteIds(data.noteIds);
    ctx.setNoteSuggestions(data.noteSuggestions ?? {});

    if (data.restoredPortfolios > 0 && data.restoredAssetMeta) {
      ctx.setPortfolioNames([]);
      api.getPortfolios().then((ps) => ctx.setPortfolioNames(ps.map((p) => p.name)));
      api.sessionState().then((s) => { if (s.note_meta) ctx.setNoteMeta(s.note_meta); });
      ctx.loadPrecalc();
      router.push("/admin/portfolio-summary");
    } else if (data.restoredNoteMeta || data.autoClassified) {
      api.sessionState().then((s) => { if (s.note_meta) ctx.setNoteMeta(s.note_meta); });
      router.push("/admin/portfolio-builder");
    } else {
      router.push("/admin/classify");
    }
  };

  return <Screen1Upload onContinue={handleUpload} />;
}
