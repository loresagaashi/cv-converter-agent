"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || (!user && typeof window !== "undefined")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-center space-y-3">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-emerald-500 border-r-transparent"></div>
          <p className="text-sm text-slate-400">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-50">
      <aside className="hidden md:flex w-64 flex-col border-r border-slate-800/60 bg-slate-950/80 px-5 py-6">
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <span className="text-emerald-400 font-bold text-sm">CV</span>
            </div>
            <span className="text-sm font-bold text-slate-50">
              CV Converter
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Manage and format your resumes
          </p>
        </div>
        <nav className="space-y-1.5 flex-1">
          <button
            onClick={() => router.push("/dashboard")}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              pathname === "/dashboard"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
            }`}
          >
            Upload CV
          </button>
          <button
            onClick={() => router.push("/dashboard/cvs")}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              pathname === "/dashboard/cvs"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
            }`}
          >
            My CVs
          </button>
          <button
            onClick={() => router.push("/dashboard/competence-summaries")}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              pathname === "/dashboard/competence-summaries"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
            }`}
          >
            Competence Summaries
          </button>
          <button
            onClick={() => router.push("/dashboard/conversation-competence-summaries")}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              pathname === "/dashboard/conversation-competence-summaries"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
            }`}
          >
            Conversation Summaries
          </button>
          {user.role === "admin" && (
            <button
              onClick={() => router.push("/dashboard/users")}
              className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                pathname === "/dashboard/users"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
              }`}
            >
              User Management
            </button>
          )}
        </nav>
        <div className="mt-auto pt-6 space-y-4">
          <button
            onClick={() => setShowLogoutModal(true)}
            className="w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:text-slate-100 transition-all duration-200 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Log out
          </button>
          <div className="border-t border-slate-800/60 pt-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-semibold text-slate-100 mb-1 truncate">
                  {user.first_name || user.last_name
                    ? `${user.first_name} ${user.last_name}`.trim()
                    : "User"}
                </div>
                <div className="text-slate-500 truncate text-xs">{user.email}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-sm px-4 py-4 md:px-6 flex-shrink-0">
          <div className="flex items-center gap-3 md:hidden">
            <div className="h-7 w-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <span className="text-emerald-400 font-bold text-xs">CV</span>
            </div>
            <span className="text-sm font-semibold text-slate-100">
              CV Converter
            </span>
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-bold text-slate-50 tracking-tight">
              {pathname === "/dashboard" && "Upload CV"}
              {pathname === "/dashboard/cvs" && "My CVs"}
              {pathname === "/dashboard/competence-summaries" && "Competence Summaries"}
              {pathname === "/dashboard/conversation-competence-summaries" && "Conversation Summaries"}
              {pathname === "/dashboard/users" && "User Management"}
              {pathname?.startsWith("/cv/") && "CV Details"}
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 bg-gradient-to-b from-slate-950 to-slate-900">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>

      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-50 mb-1">Sign out</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Are you sure you want to sign out? You'll need to sign in again to access your CVs.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:border-slate-600/80 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                  setShowLogoutModal(false);
                }}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-500/40"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


