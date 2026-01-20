"use client";

import { CVUpload } from "@/components/cv/CVUpload";
import { useAuth } from "@/components/auth/AuthContext";
import { CVRecentList } from "@/components/cv/CVRecentList";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div className="space-y-2.5">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-50 tracking-tight">
          Welcome back{user?.first_name ? `, ${user.first_name}` : ""}
        </h1>
        <p className="text-base text-slate-400 leading-relaxed max-w-2xl">
          Upload your CV to extract structured data, generate competence summaries, and create professional PDFs.
        </p>
      </div>
      <CVUpload />
      <CVRecentList />
    </div>
  );
}


