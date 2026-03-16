"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { deleteCV, bulkDeleteCVs, listCVs } from "@/lib/api";
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

  // Bulk-delete state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // --- Bulk selection helpers ---
  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev);
    setSelectedIds([]);
  };

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((cv) => cv.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!token || selectedIds.length === 0) return;
    setBulkDeleting(true);
    setError(null);
    try {
      clearCachedCVs();
      await bulkDeleteCVs(selectedIds);
      await loadCVs(true);
      setBulkDeleteModalOpen(false);
      setSelectedIds([]);
      setIsSelectionMode(false);
    } catch (err: any) {
      setError(err?.message || "Failed to delete selected CVs.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < filtered.length;

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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* Row 1: Search + Reload */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-1 sm:w-64">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search CVs"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <button
              type="button"
              onClick={() => void loadCVs(true)}
              disabled={reloading || loading}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              title="Reload CV records"
            >
              <svg className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
              </svg>
            </button>
          </div>

          {/* Row 2 (mobile) / inline (desktop): Select / Delete / Cancel */}
          {isSelectionMode ? (
            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBulkDeleteModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/25 hover:border-red-500/80 transition-all duration-200 whitespace-nowrap"
                >
                  Delete ({selectedIds.length})
                </button>
              )}
              <button
                type="button"
                onClick={toggleSelectionMode}
                className="inline-flex items-center rounded-md border border-slate-600/70 bg-slate-800/50 px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/80 hover:border-slate-500/80 transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleSelectionMode}
              className="inline-flex w-fit items-center gap-1 rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/80 hover:border-slate-600/80 transition-all duration-200 whitespace-nowrap"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Select
            </button>
          )}
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
        <div
          className={`overflow-x-auto rounded-lg border border-slate-800/60 ${filtered.length > 10 ? "max-h-155 overflow-y-auto" : ""
            }`}
        >
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/90">
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                {isSelectionMode && (
                  <th className="pl-3 pr-1 py-2.5 text-left w-9">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      aria-label="Select all"
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all duration-150 ${allSelected
                          ? "border-emerald-400 bg-emerald-400"
                          : someSelected
                            ? "border-emerald-400/70 bg-emerald-400/20"
                            : "border-slate-600 bg-transparent hover:border-slate-400"
                        }`}
                    >
                      {allSelected && (
                        <svg className="h-3 w-3 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {someSelected && !allSelected && (
                        <span className="block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      )}
                    </button>
                  </th>
                )}
                <th className="px-3 py-2.5 text-left font-semibold">Filename</th>
                <th className="px-3 py-2.5 text-left font-semibold">Uploaded</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/30">
              {filtered.map((cv) => {
                const isSelected = selectedIds.includes(cv.id);
                return (
                  <tr
                    key={cv.id}
                    onClick={isSelectionMode ? () => toggleSelectId(cv.id) : undefined}
                    className={`h-10 transition-colors ${isSelectionMode
                        ? "cursor-pointer " + (isSelected ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-slate-900/40")
                        : highlightId === cv.id
                          ? "bg-emerald-500/15"
                          : "hover:bg-slate-900/40"
                      }`}
                  >
                    {isSelectionMode && (
                      <td className="pl-3 pr-1 py-2.5 w-9">
                        <div
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all duration-150 ${isSelected
                              ? "border-emerald-400 bg-emerald-400"
                              : "border-slate-600 bg-transparent group-hover:border-slate-400"
                            }`}
                        >
                          {isSelected && (
                            <svg className="h-3 w-3 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-slate-100 font-medium">{cv.original_filename}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                      {cv.uploaded_by || "You"} •{" "}
                      {new Date(cv.uploaded_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {!isSelectionMode && (
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`/cv/${cv.id}`}
                            className="inline-flex items-center rounded-md border border-slate-700/60 bg-slate-800/40 px-2.5 py-1 text-[11px] font-semibold text-slate-100 leading-none hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
                          >
                            <svg className="mr-1 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.46 12C3.73 7.94 7.52 5 12 5s8.27 2.94 9.54 7c-1.27 4.06-5.06 7-9.54 7s-8.27-2.94-9.54-7z" />
                              <circle cx="12" cy="12" r="3" strokeWidth={1.8} />
                            </svg>
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteModal(cv)}
                            disabled={deletingId === cv.id}
                            className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-200 leading-none hover:bg-red-500/20 hover:border-red-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                          >
                            <svg className="mr-1 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            {deletingId === cv.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-col items-center gap-1">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          hasNext={currentPage < totalPages}
          hasPrevious={currentPage > 1}
          onPageChange={setCurrentPage}
          isLoading={loading || reloading}
        />
        <span className="text-xs text-slate-500">
          {filtered.length} on page • {totalRecords} total
        </span>
      </div>

      {/* Single-delete modal */}
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

      {/* Bulk-delete confirmation modal */}
      {bulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-50 mb-1">Delete {selectedIds.length} CV{selectedIds.length !== 1 ? "s" : ""}</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Are you sure you want to permanently delete the <span className="font-semibold text-slate-200">{selectedIds.length}</span> selected CV{selectedIds.length !== 1 ? "s" : ""}? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={bulkDeleting}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/30"
              >
                {bulkDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete {selectedIds.length} CV{selectedIds.length !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


