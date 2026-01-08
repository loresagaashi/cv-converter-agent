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
  const [query, setQuery] = useState("");
  const [deleteModal, setDeleteModal] = useState<CV | null>(null);

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

  const filtered = items.filter((cv) =>
    cv.original_filename.toLowerCase().includes(query.toLowerCase())
  );

  const handleDelete = async () => {
    if (!token || !deleteModal) return;
    setDeletingId(deleteModal.id);
    setError(null);
    try {
      await deleteCV(deleteModal.id, token);
      setItems((prev) => prev.filter((item) => item.id !== deleteModal.id));
      setDeleteModal(null);
    } catch (err: any) {
      setError(err?.message || "Failed to delete CV.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-base md:text-lg font-semibold text-slate-50">
            Uploaded CVs
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Browse and open your processed CVs.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[11px] text-slate-500 whitespace-nowrap">
            {filtered.length} file{filtered.length === 1 ? "" : "s"}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by CV name"
            className="w-full sm:w-64 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
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
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-6 py-8 text-center">
          <div className="mb-3 text-4xl text-slate-600">📄</div>
          <p className="text-sm font-medium text-slate-300 mb-1">No CVs found</p>
          <p className="text-xs text-slate-500">
            You haven't uploaded any CVs yet. Upload a CV from the dashboard to
            see it listed here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-6 py-8 text-center">
          <div className="mb-3 text-4xl text-slate-600">🔍</div>
          <p className="text-sm font-medium text-slate-300 mb-1">No results found</p>
          <p className="text-xs text-slate-500">
            No CVs match your search. Try different keywords.
          </p>
        </div>
      ) : (
        <div
          className={`space-y-2 ${
            filtered.length > 10 ? "max-h-96 overflow-y-auto pr-1" : ""
          }`}
        >
          {filtered.map((cv) => (
            <div
              key={cv.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-slate-100">
                  {cv.original_filename}
                </p>
                <div className="text-slate-500 text-[11px] mt-0.5">
                  <span>{cv.uploaded_by || "—"} • </span>
                  {new Date(cv.uploaded_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </div>
              <div className="ml-3 flex items-center gap-2">
                <Link
                  href={`/cv/${cv.id}`}
                  className="inline-flex items-center rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-900"
                >
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleteModal(cv)}
                  disabled={deletingId === cv.id}
                  className="inline-flex items-center rounded-lg border border-red-500/70 px-3 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deletingId === cv.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950/90 p-5 shadow-2xl">
            <div className="text-sm font-semibold text-slate-100">Delete CV</div>
            <p className="mt-2 text-sm text-slate-400">
              Are you sure you want to delete "{deleteModal.original_filename}"? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3 text-sm">
              <button
                onClick={() => setDeleteModal(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-900/70"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deletingId === deleteModal.id}
                className="rounded-lg bg-red-500 px-3 py-1.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deletingId === deleteModal.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


