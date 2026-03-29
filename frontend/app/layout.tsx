import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/AppContext";
import TopNav from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Portfolio Note Allocation Tool",
  description: "Monte Carlo-based portfolio improvement analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <TopNav />
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
