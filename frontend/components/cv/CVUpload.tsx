"use client";

import { useState, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { uploadCV } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";
import type { CV } from "@/lib/types";

interface Props {
  onUploaded?: (cv: CV) => void;
}

export function CVUpload({ onUploaded }: Props) {
  const { token } = useAuth();
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) return;
    const allowed =
      file.type === "application/pdf" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.endsWith(".pdf") ||
      file.name.endsWith(".docx");
    if (!allowed) {
      setError("Please upload a PDF or DOCX file.");
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file || null);
  };

  const onUpload = async () => {
    if (!selectedFile || !token || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const cv = await uploadCV(selectedFile, token);
      setSelectedFile(null);
      onUploaded?.(cv);
      
      // Show toast immediately while keeping loading state
      setShowToast(true);
      
      // Keep uploading state active until toast is visible, then redirect
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Then redirect
      router.push(`/dashboard/cvs?highlight=${cv.id}`);
      // Reset uploading state after redirect starts
      setTimeout(() => setUploading(false), 100);
    } catch (err: any) {
      setError(err?.message || "Upload failed. Please try again.");
      setUploading(false);
      setShowToast(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-base font-bold text-slate-50 mb-1">Upload CV</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Upload a PDF or DOCX file to get started
        </p>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all duration-200 ${
          dragOver 
            ? "border-emerald-500/60 bg-emerald-500/5" 
            : "border-slate-700/60 bg-slate-900/30"
        } px-4 py-6 text-center`}
      >
        <div className="mb-2">
          <svg className="w-8 h-8 mx-auto text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p className="text-xs font-medium text-slate-100 mb-0.5">
          Drag and drop your CV here
        </p>
        <p className="text-xs text-slate-500 mb-3">
          or click to browse files
        </p>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-500/30">
          <span>Choose file</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Supports PDF and DOCX files up to 10MB
        </p>
        {selectedFile && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-emerald-200 font-medium truncate">
                  {selectedFile.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setError(null);
                }}
                className="ml-2 rounded-lg p-1 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20 transition-all duration-200 flex-shrink-0"
                aria-label="Remove file"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/40 px-3 py-2 text-xs text-red-200">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>
      {selectedFile && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={uploading}
            onClick={onUpload}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 min-w-[120px]"
          >
            {uploading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Uploading...</span>
              </>
            ) : (
              "Upload CV"
            )}
          </button>
        </div>
      )}
      
      {/* Toast notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-xl flex items-center gap-2 border border-emerald-400/30">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            CV uploaded successfully!
          </div>
        </div>
      )}
    </div>
  );
}


