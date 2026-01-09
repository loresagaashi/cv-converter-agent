"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { convertCV, downloadFormattedCV, getCVText } from "@/lib/api";
import type { CVTextResponse, ConvertCVResponse } from "@/lib/types";

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
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-slate-50">
            CV details
          </h1>
          <p className="text-xs text-slate-400">
            View metadata, extracted text, and competence summary generated from
            this CV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadFormatted}
            disabled={downloading || !convertData?.competence_summary}
            className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {downloading ? "Generating..." : "Generate formatted CV"}
          </button>
          {/* <a
            href="/dashboard"
            className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
          >
            ← Back to main page
          </a> */}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      )}

      {downloadError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
          {downloadError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300">
            {loadingText ? (
              <div className="space-y-2">
                <div className="h-3 w-3/5 rounded bg-slate-800/70 animate-pulse" />
                <div className="h-3 w-2/5 rounded bg-slate-800/60 animate-pulse" />
              </div>
            ) : cvText ? (
              <div className="space-y-1">
                <div className="font-medium text-slate-100">
                  {cvText.original_filename}
                </div>
                <div className="text-slate-500">
                  Uploaded{" "}
                  {new Date(cvText.uploaded_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
                <div className="pt-2 text-slate-500">
                  ID: <span className="text-slate-300">{cvText.id}</span>
                </div>
              </div>
            ) : (
              <div className="text-slate-400">
                No metadata available for this CV.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">
                Competence summary
              </h2>
            </div>
            {loadingConvert ? (
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-slate-800/70 animate-pulse" />
                <div className="h-3 w-5/6 rounded bg-slate-800/60 animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-slate-800/50 animate-pulse" />
              </div>
            ) : convertData ? (
              <div className="space-y-3">
                <p className="text-slate-200 leading-relaxed">
                  {convertData.competence_summary || "No summary available."}
                </p>
                {convertData.skills?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {convertData.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-emerald-500/10 border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-200"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-slate-500 text-xs">
                We couldn&apos;t generate a competence summary for this CV.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-100">Extracted text</h2>
          </div>
          <div className="min-h-[380px] md:min-h-[460px] max-h-[82vh] md:max-h-[88vh] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] leading-relaxed">
            {loadingText ? (
              <div className="space-y-1 animate-pulse">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-2.5 rounded bg-slate-800/70"
                    style={{ width: `${80 - idx * 3}%` }}
                  />
                ))}
              </div>
            ) : cvText ? (
              cvText.text ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-200">
                  {cvText.text}
                </pre>
              ) : (
                <p className="text-slate-500">
                  No text could be extracted from this CV.
                </p>
              )
            ) : (
              <p className="text-slate-500">
                We couldn&apos;t load text for this CV.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


