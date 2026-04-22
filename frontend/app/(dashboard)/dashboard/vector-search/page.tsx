"use client";

import { useEffect, useState } from "react";
import {
  vectorSearchStatus,
  vectorSearchBulkIndex,
  vectorSearchMatch,
} from "@/lib/api";
import type {
  VectorSearchStatus,
  VectorMatchResponse,
  VectorMatchCandidate,
} from "@/lib/types";

function TierBadge({ tier }: { tier: number }) {
  const config: Record<number, { label: string; className: string }> = {
    1: { label: "Ideal", className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
    2: { label: "Stretch", className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" },
    3: { label: "Best available", className: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  };
  const { label, className } = config[tier] || config[3];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export default function VectorSearchPage() {
  const [status, setStatus] = useState<VectorSearchStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<string | null>(null);

  const [jobDescription, setJobDescription] = useState("");
  const [topK, setTopK] = useState(5);
  const [includeGapAnalysis, setIncludeGapAnalysis] = useState(false);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matchResponse, setMatchResponse] = useState<VectorMatchResponse | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const data = await vectorSearchStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleBulkIndex() {
    setIndexing(true);
    setIndexResult(null);
    try {
      const result = await vectorSearchBulkIndex({ all: true });
      setIndexResult(`Indexed ${result.indexed} CVs (${result.failed} failed)`);
      loadStatus();
    } catch (err: unknown) {
      setIndexResult(err instanceof Error ? err.message : "Indexing failed");
    } finally {
      setIndexing(false);
    }
  }

  async function handleSearch() {
    if (!jobDescription.trim()) return;
    setSearching(true);
    setSearchError(null);
    setMatchResponse(null);
    try {
      const result = await vectorSearchMatch({
        job_description: jobDescription,
        top_k: topK,
        include_gap_analysis: includeGapAnalysis,
      });
      setMatchResponse(result);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 mb-1">Index Status</h2>
            {statusLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-emerald-500 border-r-transparent animate-spin" />
                <span className="text-xs text-slate-400">Loading...</span>
              </div>
            ) : status ? (
              <p className="text-xs text-slate-400">
                <span className="text-emerald-300 font-medium">{status.indexed_count}</span>
                {" / "}
                <span>{status.total_cvs}</span> CVs indexed
                {status.chroma_ready ? (
                  <span className="ml-2 text-emerald-400">Ready</span>
                ) : (
                  <span className="ml-2 text-red-400">ChromaDB unavailable</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-red-400">Could not load status</p>
            )}
          </div>
          <button
            onClick={handleBulkIndex}
            disabled={indexing}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {indexing ? "Indexing..." : "Re-index all my CVs"}
          </button>
        </div>
        {indexResult && (
          <p className="mt-2 text-xs text-slate-400">{indexResult}</p>
        )}
      </div>

      {/* Search Form */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">Find Candidates</h2>

        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste a job description here..."
          rows={6}
          className="w-full rounded-lg border border-slate-700/60 bg-slate-900/50 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 resize-y"
        />

        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span>Top K:</span>
            <input
              type="range"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="w-24 accent-emerald-500"
            />
            <span className="text-emerald-300 font-medium w-4 text-right">{topK}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <div
              onClick={() => setIncludeGapAnalysis(!includeGapAnalysis)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                includeGapAnalysis ? "bg-emerald-500" : "bg-slate-700"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  includeGapAnalysis ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <span>Include AI screening notes</span>
          </label>
        </div>

        <button
          onClick={handleSearch}
          disabled={searching || !jobDescription.trim()}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {searching ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-r-transparent animate-spin" />
              Searching...
            </span>
          ) : (
            "Find candidates"
          )}
        </button>

        {searchError && (
          <p className="text-sm text-red-400">{searchError}</p>
        )}
      </div>

      {/* Results */}
      {matchResponse && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Results ({matchResponse.total_results})
            </h2>
            {matchResponse.parsed_jd.title && (
              <span className="text-xs text-slate-400">
                Parsed as: {matchResponse.parsed_jd.title} ({matchResponse.parsed_jd.seniority})
              </span>
            )}
          </div>

          {matchResponse.candidates.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-8 text-center">
              <p className="text-sm text-slate-400">No matching candidates found. Try indexing your CVs first.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {matchResponse.candidates.map((candidate) => (
                <CandidateCard key={candidate.id} candidate={candidate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: VectorMatchCandidate }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-slate-100 truncate">{candidate.name}</h3>
            <TierBadge tier={candidate.search_tier} />
          </div>
          <p className="text-xs text-slate-400">{candidate.current_title}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-emerald-300">
            {(candidate.composite_score * 100).toFixed(1)}%
          </div>
          <p className="text-xs text-slate-500">composite</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-slate-500">Seniority</span>
          <p className="text-slate-300">
            {candidate.stated_seniority} → {candidate.inferred_competency}
          </p>
        </div>
        <div>
          <span className="text-slate-500">Experience</span>
          <p className="text-slate-300">{candidate.years_of_experience} yrs</p>
        </div>
        <div>
          <span className="text-slate-500">Vector sim</span>
          <p className="text-slate-300">{(candidate.vector_similarity * 100).toFixed(1)}%</p>
        </div>
        <div>
          <span className="text-slate-500">Skill coverage</span>
          <p className="text-slate-300">{(candidate.skill_overlap.required_coverage * 100).toFixed(0)}%</p>
        </div>
      </div>

      {candidate.skill_overlap.matched_required.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {candidate.skill_overlap.matched_required.map((skill) => (
            <span key={skill} className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs text-emerald-300">
              {skill}
            </span>
          ))}
          {candidate.skill_overlap.missing_required.map((skill) => (
            <span key={skill} className="rounded-full bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-xs text-red-300">
              {skill}
            </span>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500 italic">{candidate.competency_note}</p>

      {candidate.gap_analysis && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            {expanded ? "Hide" : "Show"} AI screening notes
          </button>
          {expanded && (
            <p className="mt-2 text-xs text-slate-300 leading-relaxed border-l-2 border-emerald-500/30 pl-3">
              {candidate.gap_analysis}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
