"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import {
  getAllConversationCompetencePapers,
  getConversationCompetencePaper,
  deleteConversationCompetencePaper,
  type ConversationCompetencePaperWithCV,
  updateConversationCompetencePaper,
  downloadConversationCompetencePaperPdf,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import { getCachedConversationPapers, setCachedConversationPapers } from "@/lib/dashboardListCache";

export default function ConversationCompetenceSummariesPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [papers, setPapers] = useState<ConversationCompetencePaperWithCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<ConversationCompetencePaperWithCV | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [paperToDelete, setPaperToDelete] = useState<ConversationCompetencePaperWithCV | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editContent, setEditContent] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionContents, setSectionContents] = useState<Record<string, string>>({});
  const [reloading, setReloading] = useState(false);

  const listSections = new Set([
    "Core Skills",
    "Soft Skills",
    "Languages",
    "Education",
    "Trainings & Certifications",
    "Technical Competencies",
    "Project Experience",
    "Additional Information from Interview",
  ]);

  const parseListItems = (content: string): string[] => {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-•]\s*/, "").trim());
  };

  const formatListItems = (items: string[]): string => {
    return items
      .map((item) => item.trim())
      .map((item) => (item ? `- ${item}` : "- "))
      .join("\n");
  };

  const updateSectionItems = (sectionName: string, items: string[]) => {
    const updated = { ...sectionContents };
    updated[sectionName] = formatListItems(items);
    setSectionContents(updated);
  };

  const isEmptySectionContent = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return true;
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .every((line) => line === "" || line === "-" || line === "•");
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadPapers = useCallback(async (force = false) => {
    if (!token) return;

    if (!force) {
      const cached = getCachedConversationPapers();
      if (cached) {
        setPapers(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }

    setError(null);
    if (force) {
      setReloading(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await getAllConversationCompetencePapers();
      setPapers(res.papers);
      setCachedConversationPapers(res.papers);
    } catch (err: any) {
      setError(err?.message || "Failed to load conversation competence papers.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPapers(false);
  }, [loadPapers]);

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

  const parseContentIntoSections = (content: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const lines = content.split('\n');
    let currentSection: string | null = null;
    let currentContent: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this is a section header
      if (line === "Our Recommendation" || line === "Core Skills" || line === "Soft Skills" || 
          line === "Languages" || line === "Education" || line === "Trainings & Certifications" ||
          line === "Technical Competencies" || line === "Project Experience" ||
          line === "Additional Information from Interview") {
        // Save previous section
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        // Start new section
        currentSection = line;
        currentContent = [];
        // Skip the underline line
        if (i + 1 < lines.length && lines[i + 1].trim().match(/^-+$/)) {
          i++;
        }
      } else if (currentSection) {
        currentContent.push(lines[i]);
      }
    }
    
    // Save last section
    if (currentSection) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
    
    return sections;
  };

  const handleViewPaper = (paper: ConversationCompetencePaperWithCV) => {
    setSelectedPaper(paper);
    setEditContent(paper.content);
    const sections = parseContentIntoSections(paper.content);
    setSectionContents(sections);
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
      await deleteConversationCompetencePaper(paperToDelete.id);
      setPapers((prev) => {
        const next = prev.filter((p) => p.id !== paperToDelete.id);
        setCachedConversationPapers(next);
        return next;
      });
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

  const handleSaveEdit = async () => {
    if (!selectedPaper || !token) return;
    setSavingEdit(true);
    try {
      // Rebuild full content from sections before saving to ensure all edits are included
      let contentToSave = editContent;
      if (Object.keys(sectionContents).length > 0) {
        // Rebuild from current sectionContents state to capture any unsaved edits
        // No dashes/underlines - just section name and content
        contentToSave = Object.entries(sectionContents)
          .map(([name, content]) => {
            return `${name}\n${content}`;
          })
          .join("\n\n");
        // Update editContent to match
        setEditContent(contentToSave);
      }
      
      const updated = await updateConversationCompetencePaper(selectedPaper.id, contentToSave);
      setSelectedPaper(updated);
      // Update editContent and sectionContents to reflect saved changes
      setEditContent(updated.content);
      const sections = parseContentIntoSections(updated.content);
      setSectionContents(sections);
      setPapers((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? { ...p, content: updated.content } : p));
        setCachedConversationPapers(next);
        return next;
      });
    } catch (err: any) {
      setError(err?.message || "Failed to save conversation competence paper.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedPaper || !token) return;
    setDownloadingPdf(true);
    try {
      const blob = await downloadConversationCompetencePaperPdf(selectedPaper.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedPaper.cv_filename.replace(/\.[^/.]+$/, "")}_conversation_paper.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Failed to download conversation competence paper PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const hasOpenSection = editingSection !== null;

  if (!mounted) {
    return (
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-16 rounded-lg bg-white/10 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

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
          <button
            type="button"
            onClick={() => void loadPapers(true)}
            disabled={loading || reloading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
            title="Reload conversation records"
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
        <div className="overflow-x-auto md:overflow-x-visible -mx-6 px-6 md:mx-0 md:px-0">
          <div
            className={`space-y-2 min-w-max md:min-w-0 ${
              filteredPapers.length > 10 ? "max-h-[42rem] overflow-y-auto pr-1" : ""
            }`}
          >
            {filteredPapers.map((paper) => (
              <div
                key={paper.id}
                onClick={() => handleViewPaper(paper)}
                className="flex min-w-[760px] md:min-w-0 items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-3.5 hover:bg-slate-900/50 hover:border-slate-700/80 transition-all duration-200 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="mb-1.5 flex items-center gap-3">
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                      CONVERSATION BASED
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(paper.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {paper.cv_filename}
                  </p>
                  <div className="mt-1 block max-w-[52ch] text-xs text-slate-500 truncate">
                    {user?.role === "admin" && paper.user_name ? (
                      <span>{paper.user_name} • </span>
                    ) : null}
                    {paper.preview || paper.content.substring(0, 120)}
                  </div>
                </div>

                <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewPaper(paper);
                    }}
                    className="inline-flex items-center rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
                  >
                    View
                  </button>
                  <button
                    onClick={(e) => handleDeleteClick(e, paper)}
                    className="inline-flex items-center rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-200 hover:bg-red-500/20 hover:border-red-500/60 transition-all duration-200"
                    title="Delete paper"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Paper Modal */}
      {viewModalOpen && selectedPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-2 sm:px-4">
          <div className="w-full max-h-[90vh] max-w-4xl rounded-xl border border-slate-800/60 bg-slate-950/95 p-3 sm:p-5 shadow-2xl flex flex-col overflow-hidden">
            <div className="mb-4 flex items-start justify-between border-b border-slate-800/60 pb-4">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-slate-50 mb-1 tracking-tight">Conversation Competence Paper</h3>
                <div className="space-y-1">
                  <p className="text-sm text-slate-300">
                    <span className="text-slate-400 font-medium">CV:</span> <span className="text-slate-200 break-all">{selectedPaper.cv_filename}</span>
                  </p>
                  <p className="text-sm text-slate-300">
                    <span className="text-slate-400 font-medium">Created:</span> <span className="text-slate-200">{new Date(selectedPaper.created_at).toLocaleString()}</span>
                  </p>
                  {selectedPaper.user_name && (
                    <p className="text-sm text-slate-300">
                      <span className="text-slate-400 font-medium">User:</span> <span className="text-slate-200">{selectedPaper.user_name}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setViewModalOpen(false)}
                className="ml-4 rounded-lg p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-all duration-200"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 sm:pr-2">
              {/* Section-based editing UI */}
              {Object.keys(sectionContents).length > 0 ? (
                Object.entries(sectionContents).map(([sectionName, sectionContent]) => (
                  <div
                    key={sectionName}
                    className={`min-w-0 rounded-lg border p-3 shadow-sm transition-all duration-200 sm:p-4 ${
                      editingSection !== null && editingSection !== sectionName
                        ? "border-slate-900/80 bg-slate-950/70 opacity-45"
                        : "border-slate-800/60 bg-slate-900/40 hover:border-slate-700/80"
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-bold text-slate-100 text-sm">{sectionName}</h3>
                      <button
                        onClick={() => {
                          if (editingSection === sectionName) {
                            // Section content is already updated via onChange, just rebuild full content
                            // No dashes/underlines - just section name and content
                            const fullContent = Object.entries(sectionContents)
                              .map(([name, content]) => {
                                return `${name}\n${content}`;
                              })
                              .join("\n\n");
                            setEditContent(fullContent);
                            setEditingSection(null);
                          } else {
                            setEditingSection(sectionName);
                          }
                        }}
                        disabled={editingSection !== null && editingSection !== sectionName}
                        className={`inline-flex min-w-[88px] items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                          editingSection === sectionName
                            ? "border border-amber-400/40 bg-amber-400/15 text-amber-200 hover:bg-amber-400/20"
                            : "border border-slate-700/60 text-slate-300 hover:bg-slate-800/60 hover:border-slate-600/80 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        }`}
                      >
                        {editingSection === sectionName ? "Close" : "Edit"}
                      </button>
                    </div>
                    <div className={`min-w-0 text-slate-200 ${editingSection !== null && editingSection !== sectionName ? "pointer-events-none" : ""}`}>
                      {editingSection === sectionName ? (
                        listSections.has(sectionName) ? (
                          <div className="space-y-2">
                            {(parseListItems(sectionContents[sectionName] || "").length
                              ? parseListItems(sectionContents[sectionName] || "")
                              : [""]).map((item, index) => (
                              <div key={`${sectionName}-${index}`} className="flex min-w-0 items-center gap-2">
                                <input
                                  className="min-w-0 flex-1 rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/70"
                                  placeholder="Add item"
                                  value={item}
                                  onChange={(e) => {
                                    const items = parseListItems(sectionContents[sectionName] || "");
                                    const nextItems = items.length ? [...items] : [""];
                                    nextItems[index] = e.target.value;
                                    updateSectionItems(sectionName, nextItems);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/70 hover:bg-red-500/20 hover:text-red-200 sm:h-auto sm:w-auto sm:border-0 sm:bg-transparent sm:text-red-400 sm:hover:text-red-300"
                                  onClick={() => {
                                    const items = parseListItems(sectionContents[sectionName] || "");
                                    const nextItems = items.length ? [...items] : [""];
                                    nextItems.splice(index, 1);
                                    updateSectionItems(sectionName, nextItems);
                                  }}
                                  aria-label="Remove item"
                                >
                                  <span className="sm:hidden">X</span>
                                  <span className="hidden sm:inline">Remove</span>
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-all duration-200"
                              onClick={() => {
                                const items = parseListItems(sectionContents[sectionName] || "");
                                updateSectionItems(sectionName, [...items, ""]);
                              }}
                            >
                              + Add Item
                            </button>
                          </div>
                        ) : (
                          <textarea
                            className="w-full min-h-[100px] rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 font-mono whitespace-pre-wrap leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/70"
                            value={sectionContents[sectionName]}
                            onChange={(e) => {
                              const updated = { ...sectionContents };
                              updated[sectionName] = e.target.value;
                              setSectionContents(updated);
                            }}
                          />
                        )
                      ) : (
                        <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans">
                          {isEmptySectionContent(sectionContent) ? (
                            <span className="text-slate-500 italic">No content</span>
                          ) : (
                            sectionContent
                          )}
                        </pre>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                // Fallback to full textarea if sections can't be parsed
                <textarea
                  className="w-full min-h-80 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 font-mono whitespace-pre-wrap leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/70"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              )}
            </div>
            <div className="mt-4 border-t border-slate-800/60 pt-4">
              <div className="mb-2.5 flex">
                <button
                  onClick={() => router.push(`/cv/${selectedPaper.cv_id}`)}
                  className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-100 hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
                >
                  View CV
                </button>
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-end">
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf || hasOpenSection}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-slate-600 bg-slate-800/40 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-100 hover:bg-slate-800/70 hover:border-slate-500 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
                >
                  {downloadingPdf ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          d="M4 12a8 8 0 018-8"
                          strokeWidth="4"
                        />
                      </svg>
                      Exporting...
                    </>
                  ) : (
                    <>
                      {/* <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                          d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"
                        />
                      </svg> */}
                      Generate Competence Paper
                    </>
                  )}
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || hasOpenSection}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-500/40 disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
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
              <p className="text-xs text-slate-400 mb-1">From CV:</p>
              <p className="text-sm text-slate-200 font-medium break-all">{paperToDelete.cv_filename}</p>
              {paperToDelete.user_name && (
                <div className="mt-2">
                  <p className="text-xs text-slate-400 mb-1">User:</p>
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

    </div>
  );
}

