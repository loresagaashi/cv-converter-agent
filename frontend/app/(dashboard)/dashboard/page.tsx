"use client";

import dynamic from "next/dynamic";
import { CVUpload } from "@/components/cv/CVUpload";
import { useAuth } from "@/components/auth/AuthContext";

const CVRecentList = dynamic(
  () => import("@/components/cv/CVRecentList").then((m) => m.CVRecentList),
  {
    loading: () => (
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
        <div className="h-24 rounded-lg bg-white/10" />
      </div>
    ),
  }
);

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div className="space-y-2.5">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-50 tracking-tight">
          Welcome back{user?.first_name ? `, ${user.first_name}` : ""}
        </h1>
        <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
          Upload your CV to extract structured data, generate competence summaries, and create professional PDFs.
        </p>
      </div>
      <CVUpload />
      <CVRecentList />
    </div>
  );
}


