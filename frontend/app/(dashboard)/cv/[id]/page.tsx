"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { convertCV, downloadFormattedCV, getCVText } from "@/lib/api";
import { CVPreviewModal } from "@/components/cv/CVPreviewModal";
import type { CVTextResponse, ConvertCVResponse, StructuredCV } from "@/lib/types";

export default function CVDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { token } = useAuth();

  const [cvText, setCvText] = useState<CVTextResponse | null>(null);
  const [convertData, setConvertData] = useState<ConvertCVResponse | null>(null);
  const [loadingText, setLoadingText] = useState(true);
  const [loadingConvert, setLoadingConvert] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [cachedStructuredCV, setCachedStructuredCV] = useState<StructuredCV | null>(null);

  // Prevent duplicate fetches in React StrictMode / double-render.
  const ranFetch = useRef(false);

  useEffect(() => {
    if (!token || !id) return;
    if (ranFetch.current) return;
    ranFetch.current = true;
    setLoadingText(true);
    setError(null);
    getCVText(id, token)
      .then((res) => setCvText(res))
      .catch((err: any) => {
        setError(err?.message || "Failed to load CV text.");
      })
      .finally(() => setLoadingText(false));

    setLoadingConvert(true);
    convertCV(id, token)
      .then((res) => setConvertData(res))
      .catch(() => {
        // Conversion is optional UX sugar; keep failure soft.
        setConvertData(null);
      })
      .finally(() => setLoadingConvert(false));
  }, [id, token]);

  if (!id || !token) {
    return null;
  }

  const handleDownloadFormatted = async () => {
    if (!token || !id) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await downloadFormattedCV(id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (cvText?.original_filename || `cv_${id}`) + "_formatted.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setDownloadError(err?.message || "Failed to generate formatted CV.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-slate-50 mb-2 tracking-tight">
            CV Details
          </h1>
          <p className="text-base text-slate-400 leading-relaxed max-w-2xl">
            View extracted text, AI-generated competence summary, and generate formatted PDFs
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPreviewModalOpen(true)}
          disabled={!convertData?.competence_summary || loadingConvert}
          className="inline-flex items-center rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-6 py-3 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-500/80 active:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 whitespace-nowrap shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Preview & Edit
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-200">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {downloadError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-200">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {downloadError}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* File Information - Narrow with Sections */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100 mb-4">File Information</h2>
          {loadingText ? (
            <div className="space-y-3">
              <div className="h-4 w-full rounded-lg bg-white/10 animate-pulse" />
              <div className="h-3 w-3/4 rounded-lg bg-white/8 animate-pulse" />
              <div className="h-3 w-1/2 rounded-lg bg-white/6 animate-pulse" />
            </div>
          ) : cvText ? (
            <div className="space-y-3 text-xs">
              <div>
                <div className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">File Name</div>
                <div className="font-semibold text-slate-50 break-words text-sm leading-tight">
                  {cvText.original_filename}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                <div className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Upload Date</div>
                <div className="text-slate-300">
                  {new Date(cvText.uploaded_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                <div className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">File ID</div>
                <div className="text-slate-300 font-mono text-sm">{cvText.id}</div>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                <div className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Status</div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Processed
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              No metadata available
            </div>
          )}
        </div>

        {/* Competence Summary - Expanded */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-5 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-slate-100 mb-4 flex-shrink-0">
            Competence Summary
          </h2>
          <div className="h-[400px] overflow-y-auto overflow-x-hidden pr-2">
            {loadingConvert ? (
              <div className="space-y-2">
                <div className="h-3 w-full rounded-lg bg-white/10 animate-pulse" />
                <div className="h-3 w-5/6 rounded-lg bg-white/8 animate-pulse" />
                <div className="h-3 w-2/3 rounded-lg bg-white/6 animate-pulse" />
                <div className="h-3 w-4/5 rounded-lg bg-white/8 animate-pulse" />
                <div className="mt-3 pt-3 border-t border-slate-800/60">
                  <div className="h-2.5 w-1/4 rounded-lg bg-white/6 animate-pulse mb-2" />
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <div key={idx} className="h-5 w-16 rounded-full bg-white/8 animate-pulse" />
                    ))}
                  </div>
                </div>
              </div>
            ) : convertData ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-200 leading-relaxed">
                  {convertData.competence_summary || "No summary available."}
                </p>
                {convertData.skills?.length ? (
                  <div className="pt-4 border-t border-slate-800/60">
                    <p className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">Skills</p>
                    <div className="flex flex-wrap gap-2">
                      {convertData.skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full bg-emerald-500/10 border border-emerald-500/40 px-3 py-1 text-xs font-medium text-emerald-200"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Unable to generate competence summary for this CV.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Extracted Text - Full Width with Better Scrolling */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-100 mb-3">Extracted Text</h2>
        <div className="max-h-[500px] overflow-y-auto overflow-x-hidden rounded-lg border border-slate-800/60 bg-slate-950/70 px-4 py-3 text-xs leading-relaxed">
          {loadingText ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 12 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-3 rounded-lg bg-white/10"
                  style={{ width: `${85 - idx * 3}%` }}
                />
              ))}
            </div>
          ) : cvText ? (
            cvText.text ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-200">
                {cvText.text}
              </pre>
            ) : (
              <div className="text-center py-8">
                <svg className="w-8 h-8 mx-auto text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-xs text-slate-500">
                  No text could be extracted from this CV
                </p>
              </div>
            )
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-slate-500">
                Unable to load text for this CV
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      <CVPreviewModal
        cvId={id}
        token={token}
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        originalFilename={cvText?.original_filename}
        cachedStructuredCV={cachedStructuredCV}
        onStructuredCVChange={setCachedStructuredCV}
      />
    </div>
  );
}



