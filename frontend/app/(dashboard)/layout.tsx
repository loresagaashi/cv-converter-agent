"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || (!user && typeof window !== "undefined")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <div className="animate-pulse text-sm text-slate-400">
          Loading your workspace...
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <aside className="hidden md:flex w-60 flex-col border-r border-slate-800 bg-slate-950/60 px-4 py-5">
        <div className="mb-6">
          <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400 mb-1">
            CV Converter
          </span>
          <p className="text-sm text-slate-400">
            Upload, extract and analyze your CVs.
          </p>
        </div>
        <nav className="space-y-1 text-sm">
          <button
            onClick={() => router.push("/dashboard")}
            className={`w-full text-left rounded-lg px-3 py-2 font-medium transition-colors ${
              pathname === "/dashboard"
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/60"
                : "text-slate-100 hover:bg-slate-900/70"
            }`}
          >
            Upload
          </button>
          <button
            onClick={() => router.push("/dashboard/cvs")}
            className={`w-full text-left rounded-lg px-3 py-2 font-medium transition-colors ${
              pathname === "/dashboard/cvs"
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/60"
                : "text-slate-100 hover:bg-slate-900/70"
            }`}
          >
            Dashboard
          </button>
          {user.role === "admin" && (
            <button
              onClick={() => router.push("/dashboard/users")}
              className={`w-full text-left rounded-lg px-3 py-2 font-medium transition-colors ${
                pathname === "/dashboard/users"
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/60"
                  : "text-slate-100 hover:bg-slate-900/70"
              }`}
            >
              Users
            </button>
          )}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-800 text-xs text-slate-400 space-y-2">
          <div>
            <div className="font-medium text-slate-100">
              {user.first_name || user.last_name
                ? `${user.first_name} ${user.last_name}`.trim()
                : user.email}
            </div>
            <div className="text-slate-500 truncate">{user.email}</div>
          </div>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900/70"
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-bold">
              CV
            </span>
            <span className="text-sm font-medium text-slate-100">
              CV Converter
            </span>
          </div>
          <div className="hidden md:block text-sm font-medium text-slate-200">
            Dashboard
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="hidden sm:inline truncate max-w-[180px]">
              {user.email}
            </span>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-900/70"
            >
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-4 md:px-8 md:py-6 bg-gradient-to-b from-slate-950 to-slate-900">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}


