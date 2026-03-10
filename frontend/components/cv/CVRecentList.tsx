"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listCVs } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";
import { getCachedCVs, setCachedCVs } from "@/lib/dashboardListCache";

export function CVRecentList() {
  const { token } = useAuth();
  const [items, setItems] = useState<CV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const loadRecentCVs = async (force = false) => {
    if (!token) return;

    if (!force) {
      const cached = getCachedCVs();
      if (cached) {
        setItems(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }

    setError(null);
    if (force) {
      setReloading(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await listCVs();
      const sorted = [...data].sort((a, b) => b.id - a.id);
      setItems(sorted);
      setCachedCVs(sorted);
    } catch (err: any) {
      setError(err?.message || "Failed to load recent CVs.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  useEffect(() => {
    void loadRecentCVs(false);
  }, [token]);

  if (!token) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-50 mb-1.5">Recent CVs</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your most recently uploaded CVs
          </p>
        </div>
        <div className="flex items-center gap-2">
          
          <button
            type="button"
            onClick={() => void loadRecentCVs(true)}
            disabled={loading || reloading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
            title="Reload recent CV records"
          >
            <svg className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
            </svg>
          </button>
          {items.length > 0 && (
            <Link
              href="/dashboard/cvs"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400/50 transition-all duration-200"
            >
              <span>View</span>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          )}
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-14 rounded-lg bg-white/10 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-xs text-red-200">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-8 text-center">
          <svg className="w-10 h-10 mx-auto text-slate-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-slate-300 mb-1">No CVs yet</p>
          <p className="text-xs text-slate-500">
            Upload your first CV above to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {items.slice(0, 5).map((cv) => (
            <Link
              key={cv.id}
              href={`/cv/${cv.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-3.5 hover:bg-slate-900/50 hover:border-slate-700/80 transition-all duration-200 group"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100 group-hover:text-slate-50">
                  {cv.original_filename}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(cv.uploaded_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <svg className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors ml-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}


