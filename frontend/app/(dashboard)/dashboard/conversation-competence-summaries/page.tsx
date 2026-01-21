"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { getAllConversationCompetencePapers, getConversationCompetencePaper, deleteConversationCompetencePaper, type ConversationCompetencePaperWithCV } from "@/lib/api";
import { useRouter } from "next/navigation";
import { RecruiterVoiceAssistant } from "@/components/ai/RecruiterVoiceAssistant";

export default function ConversationCompetenceSummariesPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [papers, setPapers] = useState<ConversationCompetencePaperWithCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<ConversationCompetencePaperWithCV | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [paperToDelete, setPaperToDelete] = useState<ConversationCompetencePaperWithCV | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getAllConversationCompetencePapers(token)
      .then((res) => setPapers(res.papers))
      .catch((err: any) => {
        setError(err?.message || "Failed to load conversation competence papers.");
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
        paper.cv_filename?.toLowerCase().includes(query) ||
        (paper.user_name && paper.user_name.toLowerCase().includes(query)) ||
        (paper.user_email && paper.user_email.toLowerCase().includes(query))
    );
  }, [papers, searchQuery]);

  const handleViewPaper = (paper: ConversationCompetencePaperWithCV) => {
    setSelectedPaper(paper);
    setViewModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, paper: ConversationCompetencePaperWithCV) => {
    e.stopPropagation(); // Prevent card click
    setPaperToDelete(paper);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!paperToDelete || !token) return;
    
    setDeleting(true);
    try {
      await deleteConversationCompetencePaper(paperToDelete.id, token);
      // Remove from papers list
      setPapers(papers.filter((p) => p.id !== paperToDelete.id));
      setDeleteModalOpen(false);
      setPaperToDelete(null);
    } catch (err: any) {
      setError(err?.message || "Failed to delete conversation competence paper.");
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
            Conversation Competence Summaries
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            View and manage all conversation-based competence papers
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-base font-semibold text-slate-300 mb-1">No conversation papers yet</p>
          <p className="text-sm text-slate-500">
            Conversation-based competence papers will appear here after interviews are conducted
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
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  CONVERSATION BASED
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
              <div className="text-xs text-slate-400 mb-2">
                From CV: <span className="text-slate-300">{paper.cv_filename}</span>
              </div>
              {user?.role === "admin" && paper.user_name && (
                <div className="text-xs text-slate-400 mb-2">
                  User: <span className="text-slate-300">{paper.user_name}</span>
                </div>
              )}
              <p className="text-sm text-slate-400 line-clamp-3 mb-3">
                {paper.preview || paper.content.substring(0, 150) + "..."}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewPaper(paper);
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View Paper
              </button>
            </div>
          ))}
        </div>
      )}

      {/* View Paper Modal */}
      {viewModalOpen && selectedPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-50 mb-1">Conversation Competence Paper</h3>
                <p className="text-sm text-slate-400">
                  {selectedPaper.cv_filename} • {new Date(selectedPaper.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setViewModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 mb-4">
              <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {selectedPaper.content}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => router.push(`/cv/${selectedPaper.cv_id}`)}
                className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
              >
                View CV
              </button>
              <button
                onClick={() => setVoiceOpen(true)}
                className="rounded-lg border border-emerald-500/70 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400 transition-all duration-200 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
              <button
                onClick={() => setViewModalOpen(false)}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-500/40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && paperToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-100">Delete Conversation Competence Paper</h3>
            <p className="text-sm text-slate-400 leading-relaxed mt-2 mb-4">
              Are you sure you want to delete this conversation competence paper? This action cannot be undone.
            </p>
            <div className="bg-slate-900/50 rounded-lg p-3 mb-4">
              <p className="text-sm text-slate-200 font-medium">{paperToDelete.cv_filename}</p>
              {paperToDelete.user_name && (
                <div className="mt-1">
                  <p className="text-sm text-slate-200">{paperToDelete.user_name}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/30"
              >
                {deleting ? "Deleting..." : "Delete"}
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
          cvFilename={selectedPaper.cv_filename}
        />
      )}
    </div>
  );
}

