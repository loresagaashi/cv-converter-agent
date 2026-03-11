"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { deleteCV, listCVs } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";
import { Pagination } from "@/components/pagination/Pagination";
import {
  clearCachedCVs,
  getCachedCVs,
  setCachedCVs,
} from "@/lib/dashboardListCache";

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
  const [reloading, setReloading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);

  const pageSize = 50;

  const applyHighlightFromQuery = () => {
    const highlight = searchParams.get("highlight");
    if (!highlight) return;
    setHighlightId(Number(highlight));
    setTimeout(() => setHighlightId(null), 3000);
  };

  const loadCVs = useCallback(async (showReloadState = false) => {
    if (!token) return;

    if (!showReloadState) {
      const cached = getCachedCVs(currentPage, pageSize);
      if (cached) {
        setItems(cached.items);
        setTotalPages(cached.totalPages);
        setTotalRecords(cached.totalRecords);
        setError(null);
        setLoading(false);
        applyHighlightFromQuery();
        return;
      }
    }

    setError(null);
    if (showReloadState) {
      setReloading(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await listCVs(token, currentPage, pageSize);
      const sorted = [...response.data].sort((a, b) => b.id - a.id);

      if (response.totalPages > 0 && currentPage > response.totalPages) {
        setCurrentPage(response.totalPages);
        return;
      }

      setItems(sorted);
      setTotalPages(response.totalPages);
      setTotalRecords(response.totalRecords);
      setCachedCVs(currentPage, pageSize, {
        items: sorted,
        totalPages: response.totalPages,
        totalRecords: response.totalRecords,
      });
      applyHighlightFromQuery();
    } catch (err: any) {
      setError(err?.message || "Failed to load CVs.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, [currentPage, pageSize, searchParams, token]);

  useEffect(() => {
    void loadCVs(refreshTrigger !== undefined);
  }, [loadCVs, refreshTrigger, searchParams, token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

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
      clearCachedCVs();
      await deleteCV(deleteModal.id);
      await loadCVs(true);
      setDeleteModal(null);
    } catch (err: any) {
      setError(err?.message || "Failed to delete CV.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 mb-1.5 tracking-tight">
            My CVs
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Manage and view all your uploaded CVs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:flex-initial sm:w-64">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search CVs..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:block">
            {filtered.length} on page • {totalRecords} total
          </span>
          <button
            type="button"
            onClick={() => void loadCVs(true)}
            disabled={reloading || loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
            title="Reload CV records"
          >
            <svg className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="h-16 rounded-lg bg-white/10 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-200">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      ) : totalRecords === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-12 text-center">
          <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-base font-semibold text-slate-300 mb-1">No CVs yet</p>
          <p className="text-sm text-slate-500 mb-4">
            Get started by uploading your first CV from the dashboard
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all"
          >
            Upload CV
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-12 text-center">
          <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-base font-semibold text-slate-300 mb-1">No results found</p>
          <p className="text-sm text-slate-500">
            Try adjusting your search terms
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6 px-6">
          <div
            className={`space-y-2 min-w-max ${
              filtered.length > 10 ? "max-h-168 overflow-y-auto pr-1" : ""
            }`}
          >
            {filtered.map((cv) => (
              <div
                key={cv.id}
                className="flex min-w-[760px] items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-3.5 hover:bg-slate-900/50 hover:border-slate-700/80 transition-all duration-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {cv.original_filename}
                  </p>
                  <div className="text-xs text-slate-500 mt-1">
                    <span>{cv.uploaded_by || "You"} • </span>
                    {new Date(cv.uploaded_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2 shrink-0">
                  <Link
                    href={`/cv/${cv.id}`}
                    className="inline-flex items-center rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
                  >
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteModal(cv)}
                    disabled={deletingId === cv.id}
                    className="inline-flex items-center rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-200 hover:bg-red-500/20 hover:border-red-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {deletingId === cv.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        hasNext={currentPage < totalPages}
        hasPrevious={currentPage > 1}
        onPageChange={setCurrentPage}
        isLoading={loading || reloading}
      />

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-50 mb-1">Delete CV</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Are you sure you want to delete <span className="font-medium text-slate-300 break-all">"{deleteModal.original_filename}"</span>? This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deletingId === deleteModal.id}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/30"
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


