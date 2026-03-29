"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";

const adminSteps = [
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/classify", label: "Classify Notes" },
  { href: "/admin/portfolio-builder", label: "Portfolio Builder" },
  { href: "/admin/portfolio-summary", label: "Portfolio Summary" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { adminAuthenticated } = useAppContext();
  const pathname = usePathname();

  if (!adminAuthenticated) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center", padding: "0 24px" }}>
        <div className="halo-card" style={{ padding: "40px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>Admin Access Required</h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>
            Click the gear icon in the top nav to enter the admin password.
          </p>
          <Link href="/analysis" style={{
            display: "inline-block",
            padding: "10px 24px",
            background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
          }}>
            Back to Analysis
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Admin step navigation */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "8px 24px",
        background: "rgba(255,255,255,0.02)",
        borderBottom: "1px solid var(--border)",
      }}>
        {adminSteps.map((s, i) => {
          const active = pathname === s.href;
          return (
            <div key={s.href} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: "12px", margin: "0 4px" }}>→</span>}
              <Link
                href={s.href}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--halo-cyan)" : "var(--text-secondary)",
                  background: active ? "rgba(0,183,205,0.1)" : "transparent",
                  border: `1px solid ${active ? "rgba(0,183,205,0.3)" : "transparent"}`,
                  borderRadius: "6px",
                  textDecoration: "none",
                  transition: "all 0.2s",
                }}
              >
                {s.label}
              </Link>
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <Link href="/analysis" style={{
          fontSize: "12px",
          color: "var(--text-muted)",
          textDecoration: "none",
        }}>
          ← Back to Analysis
        </Link>
      </div>

      {/* Light background wrapper matching old step UI */}
      <main style={{ padding: "32px 24px" }}>
        <div style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "#f0f4f8",
          borderRadius: "12px",
          padding: "24px",
          color: "#1e293b",
        }}>
          {children}
        </div>
      </main>
    </div>
  );
}
