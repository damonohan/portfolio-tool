"use client";

import { useRouter } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";
import Screen3PortfolioBuilder from "@/components/Screen3PortfolioBuilder";
import { api } from "@/lib/api";

export default function AdminPortfolioBuilderPage() {
  const router = useRouter();
  const ctx = useAppContext();

  const handlePortfolioBuilt = async () => {
    const ps = await api.getPortfolios();
    ctx.setPortfolioNames(ps.map((p) => p.name));
    await ctx.loadPrecalc();
    router.push("/admin/portfolio-summary");
  };

  return (
    <Screen3PortfolioBuilder
      assetCols={ctx.assetCols}
      noteIds={ctx.noteIds}
      noteMeta={ctx.noteMeta}
      onContinue={handlePortfolioBuilt}
    />
  );
}
