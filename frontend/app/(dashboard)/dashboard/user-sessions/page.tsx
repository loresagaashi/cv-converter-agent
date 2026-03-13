"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthContext";
import { clearExpiredUserSessions, listUserSessions } from "@/lib/api";
import type { UserSession } from "@/lib/types";
import { Pagination } from "@/components/pagination/Pagination";
import {
  clearCachedUserSessions,
  getCachedUserSessions,
  setCachedUserSessions,
} from "@/lib/dashboardListCache";

export default function UserSessionsPage() {
  const { user, token } = useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [clearingExpired, setClearingExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);

  const pageSize = 50;
  const isAdmin = useMemo(() => user?.role === "admin", [user]);
  const hasExpiredSessions = useMemo(
    () => sessions.some((session) => new Date(session.expires_at).getTime() < Date.now()),
    [sessions]
  );

  const loadSessions = useCallback(
    async (showReloadState = false) => {
      if (!token || !isAdmin) return;

      if (!showReloadState) {
        const cached = getCachedUserSessions(currentPage, pageSize);
        if (cached) {
          setSessions(cached.items);
          setTotalPages(cached.totalPages);
          setTotalRecords(cached.totalRecords);
          setError(null);
          setLoading(false);
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
        const response = await listUserSessions(token, currentPage, pageSize);

        if (response.totalPages > 0 && currentPage > response.totalPages) {
          setCurrentPage(response.totalPages);
          return;
        }

        setSessions(response.data);
        setTotalPages(response.totalPages);
        setTotalRecords(response.totalRecords);
        setCachedUserSessions(currentPage, pageSize, {
          items: response.data,
          totalPages: response.totalPages,
          totalRecords: response.totalRecords,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unable to load user sessions.";
        setError(message);
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [currentPage, isAdmin, token]
  );

  useEffect(() => {
    if (!user || !token) return;
    if (!isAdmin) {
      router.replace("/dashboard");
      return;
    }
    void loadSessions(false);
  }, [isAdmin, loadSessions, router, token, user]);

  if (!user || !token) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-50">User Sessions</h1>
        <p className="text-sm text-slate-400">You do not have permission to access this page.</p>
      </div>
    );
  }

  const handleClearExpired = async () => {
    if (!token) return;
    setClearingExpired(true);
    setError(null);
    setMessage(null);
    try {
      clearCachedUserSessions();
      const result = await clearExpiredUserSessions(token);
      setMessage(`Deleted ${result.deleted_count} expired token(s).`);
      await loadSessions(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to clear expired tokens.";
      setError(message);
    } finally {
      setClearingExpired(false);
    }
  };

  const formatDateTime = (value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 mb-1 tracking-tight">User Sessions</h1>
            <p className="text-sm text-slate-400">Refresh-token sessions across all users</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:block">
              {sessions.length} on page • {totalRecords} total
            </span>
            <button
              type="button"
              onClick={() => void loadSessions(true)}
              disabled={loading || reloading || clearingExpired}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              title="Reload session records"
            >
              <svg className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void handleClearExpired()}
              disabled={loading || reloading || clearingExpired || !hasExpiredSessions}
              className="inline-flex items-center rounded-lg border border-amber-500/50 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/70 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              title={hasExpiredSessions ? "Clear expired sessions" : "No expired sessions to clear"}
            >
              {clearingExpired ? "Clearing..." : "Clear expired sessions"}
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/40 px-4 py-2.5 text-sm text-emerald-200">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-2.5 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-12 rounded-lg bg-white/10 animate-pulse" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-12 text-center">
            <p className="text-base font-semibold text-slate-300 mb-1">No sessions found</p>
            <p className="text-sm text-slate-500">Sessions will appear here after users log in.</p>
          </div>
        ) : (
          <div
            className={`overflow-x-auto rounded-lg border border-slate-800/60 ${
              sessions.length > 10 ? "max-h-149 overflow-y-auto" : ""
            }`}
          >
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/90">
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2.5 text-left font-semibold">User</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Email</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Created</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ends</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/30">
                {sessions.map((session) => {
                  const displayName =
                    `${session.user_first_name || ""} ${session.user_last_name || ""}`.trim() ||
                    "(No name)";
                  const isExpired = new Date(session.expires_at).getTime() < Date.now();

                  return (
                    <tr key={session.id} className="h-10 hover:bg-slate-900/40 transition-colors">
                      <td className="px-3 py-2.5 text-slate-100 font-medium whitespace-nowrap">{displayName}</td>
                      <td className="px-3 py-2.5 text-slate-400">{session.user_email}</td>
                      <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{formatDateTime(session.created_at)}</td>
                      <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{formatDateTime(session.expires_at)}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isExpired
                              ? "bg-red-500/15 text-red-300 border border-red-500/40"
                              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                          }`}
                        >
                          {isExpired ? "Expired" : "Active"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        hasNext={currentPage < totalPages}
        hasPrevious={currentPage > 1}
        onPageChange={setCurrentPage}
        isLoading={loading || reloading || clearingExpired}
      />
    </div>
  );
}
