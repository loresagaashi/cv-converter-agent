"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { deleteCV, listCVs } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";

interface Props {
  refreshTrigger?: number;
}

export function CVTable({ refreshTrigger }: Props) {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<CV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  useEffect(() => {
    // Add glow animation styles
    const style = document.createElement('style');
    style.textContent = `
      @keyframes cv-glow {
        0%, 100% {
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.4), -15px 0 15px rgba(239, 68, 68, 0.4), 15px 0 15px rgba(239, 68, 68, 0.4);
        }
        50% {
          box-shadow: 0 0 25px rgba(239, 68, 68, 0.6), -25px 0 25px rgba(239, 68, 68, 0.6), 25px 0 25px rgba(239, 68, 68, 0.6);
        }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    listCVs(token)
      .then((data) => {
        // Sort by ID descending - newest (highest ID) first
        const sorted = [...data].sort((a, b) => b.id - a.id);
        setItems(sorted);
        
        // Check for highlight parameter
        const highlight = searchParams.get('highlight');
        if (highlight) {
          setHighlightId(Number(highlight));
          setTimeout(() => setHighlightId(null), 3000);
        }
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to load CVs.");
      })
      .finally(() => setLoading(false));
  }, [token, refreshTrigger, searchParams]);

  if (!token) {
    return null;
  }

  const handleDelete = async (cv: CV) => {
    if (!token) return;
    const confirmed = window.confirm(
      `Delete CV "${cv.original_filename}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(cv.id);
    setError(null);
    try {
      await deleteCV(cv.id, token);
      setItems((prev) => prev.filter((item) => item.id !== cv.id));
    } catch (err: any) {
      setError(err?.message || "Failed to delete CV.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base md:text-lg font-semibold text-slate-50">
            Uploaded CVs
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Browse and open your processed CVs.
          </p>
        </div>
        <span className="text-[11px] text-slate-500">
          {items.length} file{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="h-9 rounded-lg bg-slate-800/60 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">
          You haven't uploaded any CVs yet. Upload a CV from the dashboard to
          see it listed here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-1 text-xs md:text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-medium">CV name</th>
                <th className="px-3 py-2 font-medium">Uploaded by</th>
                <th className="px-3 py-2 font-medium">Uploaded at</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((cv) => (
                <tr
                  key={cv.id}
                  className={`rounded-xl text-slate-100 shadow-sm hover:bg-slate-900/90 ${
                    highlightId === cv.id
                      ? "border border-red-400/60 bg-slate-900/90"
                      : "border border-slate-800/50 bg-slate-900/70"
                  }`}
                  style={highlightId === cv.id ? {
                    animation: 'cv-glow 2s ease-in-out infinite'
                  } : undefined}
                >
                  <td className="max-w-xs truncate px-3 py-2 align-middle">
                    <span className="block font-medium">
                      {cv.original_filename}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-middle text-slate-300">
                    {cv.uploaded_by || "—"}
                  </td>
                  <td className="px-3 py-2 align-middle text-slate-300">
                    {new Date(cv.uploaded_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-3 py-2 align-middle text-right space-x-2">
                    <Link
                      href={`/cv/${cv.id}`}
                      className="inline-flex items-center rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-900"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(cv)}
                      disabled={deletingId === cv.id}
                      className="inline-flex items-center rounded-lg border border-red-500/70 px-3 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {deletingId === cv.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


