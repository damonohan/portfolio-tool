"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";

interface Props {
  onClose: () => void;
}

export default function AdminPasswordModal({ onClose }: Props) {
  const { adminAuthenticated, setAdminAuthenticated } = useAppContext();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  if (adminAuthenticated) {
    // Already authed — just navigate
    router.push("/admin/upload");
    onClose();
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "Halo1234!") {
      setAdminAuthenticated(true);
      onClose();
      router.push("/admin/upload");
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "32px",
          width: "100%",
          maxWidth: "380px",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "4px" }}>
          Admin Access
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>
          Enter the admin password to access data management screens.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "var(--bg-primary)",
              border: `1px solid ${error ? "var(--accent-red)" : "var(--border)"}`,
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "14px",
              marginBottom: "8px",
              outline: "none",
            }}
          />
          {error && (
            <p style={{ fontSize: "12px", color: "var(--accent-red)", marginBottom: "8px" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: "10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text-secondary)",
                fontSize: "13px", fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 1, padding: "10px",
                background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "13px", fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Enter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
