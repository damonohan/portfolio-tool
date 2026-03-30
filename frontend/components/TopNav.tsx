"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminPasswordModal from "./AdminPasswordModal";

export default function TopNav() {
  const pathname = usePathname();
  const [showAdminModal, setShowAdminModal] = useState(false);

  const navLinks = [
    { href: "/analysis", label: "Analysis" },
    { href: "/frontier", label: "Frontier" },
  ];

  // Don't show top nav on admin pages (they have their own nav)
  const isAdmin = pathname?.startsWith("/admin");

  return (
    <>
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
      }}>
        {/* Left: Logo + Title */}
        <Link href="/analysis" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
          <span style={{ fontSize: "24px" }}>📊</span>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>
              Portfolio Note Allocation Tool
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Monte Carlo-based improvement analysis
            </div>
          </div>
        </Link>

        {/* Center: Nav links */}
        {!isAdmin && (
          <div style={{ display: "flex", gap: "4px" }}>
            {navLinks.map((link) => {
              const active = pathname === link.href || pathname?.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: active ? "var(--halo-cyan)" : "var(--text-secondary)",
                    textDecoration: "none",
                    borderBottom: active ? "2px solid var(--halo-cyan)" : "2px solid transparent",
                    transition: "all 0.2s",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        )}

        {/* Right: Admin link */}
        <button
          onClick={() => setShowAdminModal(true)}
          title="Admin Settings"
          style={{
            background: "none",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            padding: "6px 12px",
            borderRadius: "6px",
            fontSize: "16px",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
          }}
        >
          <span>⚙</span>
        </button>
      </nav>
      {showAdminModal && <AdminPasswordModal onClose={() => setShowAdminModal(false)} />}
    </>
  );
}
