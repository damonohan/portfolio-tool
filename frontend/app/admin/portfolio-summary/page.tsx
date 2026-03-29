"use client";

import { useRouter } from "next/navigation";
import Screen4PortfolioSummary from "@/components/Screen4PortfolioSummary";

export default function AdminPortfolioSummaryPage() {
  const router = useRouter();

  return (
    <Screen4PortfolioSummary onContinue={() => router.push("/analysis")} />
  );
}
