"use client";

import { CVUpload } from "@/components/cv/CVUpload";
import { useAuth } from "@/components/auth/AuthContext";
import { CVRecentList } from "@/components/cv/CVRecentList";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl md:text-2xl font-semibold text-slate-50">
          Welcome back
          {user?.first_name ? `, ${user.first_name}` : ""}.
        </h1>
        <p className="text-xs md:text-sm text-slate-400">
          Upload new CVs, review past uploads, and explore extracted text and
          competence insights.
        </p>
      </div>
      <CVUpload />
      <CVRecentList />
    </div>
  );
}


