"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { getAllCompetencePapers, getCompetencePaper, deleteCompetencePaper, type CompetencePaperWithCV } from "@/lib/api";
import { useRouter } from "next/navigation";
import { RecruiterVoiceAssistant } from "@/components/ai/RecruiterVoiceAssistant";

export default function CompetenceSummariesPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [papers, setPapers] = useState<CompetencePaperWithCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<CompetencePaperWithCV | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [paperToDelete, setPaperToDelete] = useState<CompetencePaperWithCV | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getAllCompetencePapers()
      .then((res) => setPapers(res.papers))
      .catch((err: any) => {
        setError(err?.message || "Failed to load competence papers.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Filter papers based on search query
  const filteredPapers = useMemo(() => {
    if (!searchQuery.trim()) return papers;
    const query = searchQuery.toLowerCase();
    return papers.filter(
      (paper) =>
        paper.content.toLowerCase().includes(query) ||
        paper.cv_filename.toLowerCase().includes(query) ||
        (paper.user_name && paper.user_name.toLowerCase().includes(query)) ||
        (paper.user_email && paper.user_email.toLowerCase().includes(query))
    );
  }, [papers, searchQuery]);

  const handleViewPaper = (paper: CompetencePaperWithCV) => {
    setSelectedPaper(paper);
    setViewModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, paper: CompetencePaperWithCV) => {
    e.stopPropagation(); // Prevent card click
    setPaperToDelete(paper);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!paperToDelete || !token) return;
    
    setDeleting(true);
    try {
      await deleteCompetencePaper(paperToDelete.id);
      // Remove from papers list
      setPapers(papers.filter((p) => p.id !== paperToDelete.id));
      setDeleteModalOpen(false);
      setPaperToDelete(null);
    } catch (err: any) {
      setError(err?.message || "Failed to delete competence paper.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModalOpen(false);
    setPaperToDelete(null);
  };

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 mb-1.5 tracking-tight">
            Competence Summaries
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            View and manage all stored competence papers across your CVs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:flex-initial sm:w-64">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by content, CV filename, or user..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:block">
            {filteredPapers.length} {filteredPapers.length === 1 ? "paper" : "papers"}
          </span>
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
      ) : filteredPapers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-12 text-center">
          <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-base font-semibold text-slate-300 mb-1">No competence papers yet</p>
          <p className="text-sm text-slate-500">
            Competence papers will appear here after you export them from CV preview
          </p>
        </div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPapers.map((paper) => (
              <div
                key={paper.id}
                onClick={() => handleViewPaper(paper)}
                className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 hover:border-emerald-500/50 hover:bg-slate-800/50 cursor-pointer transition-all duration-200 relative group"
              >
                <button
                  onClick={(e) => handleDeleteClick(e, paper)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400 transition-all duration-200 z-10 opacity-0 group-hover:opacity-100"
                  title="Delete paper"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                    {paper.paper_type === 'original' ? 'ORIGINAL' : 'INTERVIEW BASED'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(paper.created_at).toLocaleString(undefined, {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mb-2">
                  <p className="text-xs text-slate-400 mb-1">From CV:</p>
                  <p className="text-xs font-medium text-slate-300 truncate">
                    {paper.cv_filename}
                  </p>
                  {user?.role === "admin" && paper.user_name && (
                    <p className="text-xs text-slate-500 mt-1">
                      User: {paper.user_name}
                    </p>
                  )}
                </div>
                <p className="text-sm text-slate-300 line-clamp-3 mb-3">
                  {paper.preview || paper.content.substring(0, 150)}
                </p>
                <div className="flex items-center text-xs text-emerald-400">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Paper
                </div>
              </div>
            ))}
          </div>
        )}

      {/* View Paper Modal */}
      {viewModalOpen && selectedPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl max-h-[90vh] mx-4 bg-slate-950 rounded-xl border border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  Competence Paper - {selectedPaper.paper_type === 'original' ? 'Original' : 'Interview Based'}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  From: {selectedPaper.cv_filename}
                </p>
              </div>
              <button
                onClick={() => {
                  setViewModalOpen(false);
                  setSelectedPaper(null);
                }}
                className="text-slate-400 hover:text-slate-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
              <div className="mb-4 text-xs text-slate-400">
                Created: {new Date(selectedPaper.created_at).toLocaleString()}
              </div>
              <div className="prose prose-invert max-w-none">
                <pre className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                  {selectedPaper.content}
                </pre>
              </div>
            </div>
            <div className="border-t border-slate-800 p-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setViewModalOpen(false);
                  router.push(`/cv/${selectedPaper.cv_id}`);
                }}
                className="inline-flex items-center rounded-lg border border-slate-700/70 bg-slate-900/70 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 hover:border-slate-500 transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View CV
              </button>
              <button
                onClick={() => setVoiceOpen(true)}
                className="inline-flex items-center rounded-lg border border-emerald-500/70 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400 transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M19 10v2a7 7 0 01-14 0v-2M12 17v4m0 0H9m3 0h3"
                  />
                </svg>
                Talk to AI
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPaper && (
        <RecruiterVoiceAssistant
          isOpen={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          cvId={selectedPaper.cv_id}
          paperId={selectedPaper.id}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && paperToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md mx-4 bg-slate-950 rounded-xl border border-slate-800 shadow-2xl">
            <div className="p-5 border-b border-slate-800">
              <h3 className="text-lg font-bold text-slate-100">Delete Competence Paper</h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-300 mb-4">
                Are you sure you want to delete this competence paper? This action cannot be undone.
              </p>
              <div className="bg-slate-900/50 rounded-lg p-3 mb-4">
                <p className="text-xs text-slate-400 mb-1">From CV:</p>
                <p className="text-sm text-slate-200 font-medium">{paperToDelete.cv_filename}</p>
                {paperToDelete.user_name && (
                  <>
                    <p className="text-xs text-slate-400 mb-1 mt-2">User:</p>
                    <p className="text-sm text-slate-200">{paperToDelete.user_name}</p>
                  </>
                )}
              </div>
            </div>
            <div className="border-t border-slate-800 p-4 flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                disabled={deleting}
                className="rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:border-slate-600/80 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
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

