"use client";

import { useEffect, useState } from "react";
import { listCVs } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";
import Link from "next/link";

interface Props {
  refreshTrigger?: number;
}

export function CVList({ refreshTrigger }: Props) {
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
        // API returns newest last; reverse for dashboard UX if desired.
        setItems([...data].reverse());
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to load CVs.");
      })
      .finally(() => setLoading(false));
  }, [token, refreshTrigger]);

  if (!token) {
    return null;
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-100">
          Your uploaded CVs
        </h2>
        <span className="text-[11px] text-slate-500">
          {items.length} file{items.length === 1 ? "" : "s"}
        </span>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-9 rounded-lg bg-slate-800/60 animate-pulse" />
          <div className="h-9 rounded-lg bg-slate-800/40 animate-pulse" />
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">
          You haven&apos;t uploaded any CVs yet. Upload your first CV to see it
          here.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((cv) => (
            <div
              key={cv.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs"
            >
              <div className="flex flex-col">
                <span className="font-medium text-slate-100 truncate max-w-xs sm:max-w-md">
                  {cv.original_filename}
                </span>
                <span className="text-slate-500">
                  Uploaded{" "}
                  {new Date(cv.uploaded_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
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


