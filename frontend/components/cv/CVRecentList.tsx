"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listCVs } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";

export function CVRecentList() {
  const { token } = useAuth();
  const [items, setItems] = useState<CV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    listCVs(token)
      .then((data) => {
        const ordered = [...data].reverse();
        setItems(ordered.slice(0, 5));
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to load recent CVs.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">Recent CVs</h2>
        <Link
          href="/dashboard/cvs"
          className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
        >
          Go to dashboard →
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-8 rounded-lg bg-slate-800/60 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">
          No CVs yet. Upload your first CV above to see it here.
        </p>
      ) : (
        <div className="space-y-2 text-xs">
          {items.map((cv) => (
            <div
              key={cv.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-100">
                  {cv.original_filename}
                </p>
                <p className="text-[11px] text-slate-500">
                  {new Date(cv.uploaded_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <Link
                href={`/cv/${cv.id}`}
                className="ml-3 inline-flex items-center rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-900"
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


