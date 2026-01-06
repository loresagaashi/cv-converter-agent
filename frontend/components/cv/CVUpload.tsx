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
    if (!selectedFile || !token) return;
    setUploading(true);
    setError(null);
    try {
      const cv = await uploadCV(selectedFile, token);
      setSelectedFile(null);
      onUploaded?.(cv);
      
      // Keep uploading state for 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      setUploading(false);
      
      // Show toast for 1 second
      setShowToast(true);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Then redirect
      router.push(`/dashboard/cvs?highlight=${cv.id}`);
    } catch (err: any) {
      setError(err?.message || "Upload failed. Please try again.");
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-4 sm:p-5">
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
        className={`flex flex-col items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/60 px-4 py-6 text-center transition-colors ${
          dragOver ? "border-emerald-500/70 bg-slate-900" : ""
        }`}
      >
        <p className="text-sm font-medium text-slate-100 mb-1">
          Drag & drop your CV here
        </p>
        <p className="text-xs text-slate-500 mb-3">
          PDF or DOCX, up to 10MB.
        </p>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-white">
          <span>Browse files</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </label>
        {selectedFile && (
          <div className="mt-3 text-xs text-slate-300">
            Selected:{" "}
            <span className="font-medium text-emerald-300">
              {selectedFile.name}
            </span>
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200 border border-red-500/30">
            {error}
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!selectedFile || uploading}
          onClick={onUpload}
          className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 shadow-md shadow-emerald-500/40 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Uploading..." : "Upload CV"}
        </button>
      </div>
      
      {/* Toast notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white shadow-lg flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            File uploaded successfully!
          </div>
        </div>
      )}
    </div>
  );
}


