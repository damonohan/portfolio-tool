"use client";

import Link from "next/link";

export default function HistogramsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
      <div className="halo-card" style={{ padding: 40 }}>
        <p style={{ color: "var(--accent-red)", fontSize: 15, marginBottom: 16 }}>{error.message}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              background: "rgba(0,183,205,0.1)", border: "1px solid var(--halo-cyan)",
              color: "var(--halo-cyan)", padding: "8px 20px", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Try Again
          </button>
          <Link href="/analysis" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontWeight: 600, padding: "8px 20px" }}>
            ← Back to Analysis
          </Link>
        </div>
      </div>
    </div>
  );
}
