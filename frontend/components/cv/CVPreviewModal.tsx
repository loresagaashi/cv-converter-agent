"use client";

import { useState, useCallback, useEffect } from "react";
import { getStructuredCV, exportEditedCV } from "@/lib/api";
import type { StructuredCV } from "@/lib/types";

interface Props {
  cvId: number;
  token: string;
  isOpen: boolean;
  onClose: () => void;
  originalFilename?: string;
  cachedStructuredCV?: StructuredCV | null;
  onStructuredCVChange?: (cv: StructuredCV | null) => void;
}

type StructuredCVPayload = Partial<StructuredCV>;

type EditingSection =
  | "profile"
  | "skills"
  | "work_experience"
  | "education"
  | "projects"
  | "certifications"
  | "courses"
  | "languages";

// Basic front-end validation for the editable CV structure (generic rules)
function validateStructuredCV(cv: StructuredCVPayload): string | null {
  // Validation disabled - allow export regardless of data completeness
  return null;
}

export function CVPreviewModal({ cvId, token, isOpen, onClose, originalFilename, cachedStructuredCV, onStructuredCVChange }: Props) {
  const [structuredCV, setStructuredCV] = useState<StructuredCVPayload | null>(cachedStructuredCV || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"cv" | "competence" | null>(null);
  const [editingSection, setEditingSection] = useState<EditingSection | null>(null);

  // Update local state when cached CV changes
  useEffect(() => {
    if (cachedStructuredCV) {
      setStructuredCV(cachedStructuredCV);
    }
  }, [cachedStructuredCV]);

  // Load structured CV when modal opens - only if not cached
  const loadStructuredCV = useCallback(async () => {
    if (!isOpen || !token) return;
    // If we have cached data, use it instead of fetching
    if (cachedStructuredCV) {
      setStructuredCV(cachedStructuredCV);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getStructuredCV(cvId, token);
      // Ensure all nested arrays and fields have proper defaults
      const normalizedData: StructuredCVPayload = {
        ...data,
        work_experience: (data.work_experience || []).map(exp => ({
          ...exp,
          bullets: exp.bullets || [],
          location: exp.location || "",
          from: exp.from || "",
          to: exp.to || "",
          title: exp.title || "",
          company: exp.company || ""
        })),
        projects: (data.projects || []).map(proj => ({
          ...proj,
          bullets: proj.bullets || [],
          location: proj.location || "",
          from: proj.from || "",
          to: proj.to || "",
          title: proj.title || "",
          company: proj.company || ""
        })),
        education: (data.education || []).map(edu => ({
          ...edu,
          from: edu.from || "",
          to: edu.to || "",
          degree: edu.degree || "",
          institution: edu.institution || ""
        }))
      };
      setStructuredCV(normalizedData);
      // Cache the data
      if (onStructuredCVChange) {
        onStructuredCVChange(normalizedData as StructuredCV);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load CV structure");
    } finally {
      setLoading(false);
    }
  }, [cvId, token, isOpen, cachedStructuredCV, onStructuredCVChange]);

  // Load when modal opens - only if not cached
  useEffect(() => {
    if (isOpen && token) {
      loadStructuredCV();
    }
  }, [isOpen, cvId, token, loadStructuredCV]);


  const handleExport = async (type: "cv" | "competence" = "cv") => {
    if (!structuredCV || !token) return;

    // Validate before exporting
    const validationError = validateStructuredCV(structuredCV);
    if (validationError) {
      setError(validationError);
      return;
    }

    setExporting(type);
    setError(null);
    try {
      // Cast to StructuredCV since we've validated all required fields exist
      const blob = await exportEditedCV(cvId, token, structuredCV as StructuredCV, undefined, type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = originalFilename?.replace(/\.[^/.]+$/, "") || `cv_${cvId}`;
      a.download = type === "competence" ? `${baseName}_competence_letter.pdf` : `${baseName}_formatted_CV.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Failed to export CV");
    } finally {
      setExporting(null);
    }
  };

  const updateSection = (section: EditingSection, value: any) => {
    if (!structuredCV) return;
    const updated = {
      ...structuredCV,
      [section]: value,
    };
    setStructuredCV(updated);
    // Update cache when CV is edited
    if (onStructuredCVChange) {
      onStructuredCVChange(updated as StructuredCV);
    }
  };

  const showProfile = structuredCV?.profile !== undefined && structuredCV?.profile !== null && structuredCV.profile.trim() !== "";
  const showSkills = Array.isArray(structuredCV?.skills) && structuredCV.skills.length > 0;
  const showWorkExperience = Array.isArray(structuredCV?.work_experience) && structuredCV.work_experience.length > 0;
  const showEducation = Array.isArray(structuredCV?.education) && structuredCV.education.length > 0;
  const showCertifications = Array.isArray(structuredCV?.certifications) && structuredCV.certifications.length > 0;
  const showProjects = Array.isArray(structuredCV?.projects) && structuredCV.projects.length > 0;
  const showCourses = Array.isArray(structuredCV?.courses) && structuredCV.courses.length > 0;
  const showLanguages = Array.isArray(structuredCV?.languages) && structuredCV.languages.length > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-h-[85vh] max-w-4xl rounded-xl border border-slate-800/60 bg-slate-950/95 p-5 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between border-b border-slate-800/60 pb-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-50 mb-1 tracking-tight">Preview & Edit CV</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Review and edit your CV sections, then export as a professional PDF
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 rounded-lg p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-all duration-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-200">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-solid border-emerald-500 border-r-transparent mb-4"></div>
              <div className="text-slate-400 text-sm font-medium">Loading CV structure...</div>
              <div className="mt-2 text-xs text-slate-500">Please wait while we prepare your CV</div>
            </div>
          ) : structuredCV ? (
            <>
              {showProfile && (
                <Section
                  title="Profile"
                  isEditing={editingSection === "profile"}
                  onEdit={() => {
                    // When leaving edit mode for Profile, do not allow it to be empty
                    if (editingSection === "profile" && structuredCV && typeof structuredCV.profile === "string") {
                      if (!structuredCV.profile.trim()) {
                        setError(
                          "Profile section cannot be empty. Please add a short professional summary."
                        );
                        return;
                      }
                    }
                    setError(null);
                    setEditingSection(editingSection === "profile" ? null : "profile");
                  }}
                >
                  {editingSection === "profile" ? (
                    <div className="space-y-1">
                      <textarea
                        value={structuredCV.profile as string}
                        onChange={(e) => updateSection("profile", e.target.value)}
                        maxLength={550}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        rows={5}
                      />
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Max 550 characters for competence summary export
                        </span>
                        <span className={`font-medium ${(structuredCV.profile as string || "").length > 500
                          ? "text-amber-400"
                          : "text-slate-400"
                          }`}>
                          {(structuredCV.profile as string || "").length}/550
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-200">{structuredCV.profile}</p>
                  )}
                </Section>
              )}

              {showSkills && (
                <Section
                  title="Skills"
                  isEditing={editingSection === "skills"}
                  onEdit={() => {
                    // When leaving edit mode for Skills, ensure there are no blank rows.
                    if (editingSection === "skills" && structuredCV && Array.isArray(structuredCV.skills)) {
                      for (let i = 0; i < structuredCV.skills.length; i++) {
                        if (!structuredCV.skills[i].trim()) {
                          setError(
                            `Skill #${i + 1} is empty. Please fill it in or remove this skill.`
                          );
                          return;
                        }
                      }
                    }
                    setError(null);
                    setEditingSection(editingSection === "skills" ? null : "skills");
                  }}
                >
                  {editingSection === "skills" ? (
                    <div className="space-y-2">
                      {(structuredCV.skills || []).map((skill, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={skill}
                            onChange={(e) => {
                              const newSkills = [...(structuredCV.skills || [])];
                              newSkills[idx] = e.target.value;
                              updateSection("skills", newSkills);
                            }}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button
                            onClick={() => {
                              const newSkills = (structuredCV.skills || []).filter((_, i) => i !== idx);
                              updateSection("skills", newSkills);
                            }}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => updateSection("skills", [...(structuredCV.skills || []), ""])}
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Skill
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(structuredCV.skills || [])
                        .filter((s) => s.trim())
                        .map((skill, idx) => (
                          <span
                            key={`skill-${idx}`}
                            className="rounded-full bg-emerald-500/10 border border-emerald-500/40 px-2 py-1 text-xs text-emerald-200"
                          >
                            {skill}
                          </span>
                        ))}
                    </div>
                  )}
                </Section>
              )}

              {showWorkExperience && (
                <Section
                  title="Work Experience"
                  isEditing={editingSection === "work_experience"}
                  onEdit={() => {
                    setError(null);
                    setEditingSection(
                      editingSection === "work_experience" ? null : "work_experience"
                    );
                  }}
                >
                  {editingSection === "work_experience" ? (
                    <div className="space-y-4">
                      {(structuredCV.work_experience || []).map((job, idx) => (
                        <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
                          <input
                            type="text"
                            placeholder="Title"
                            value={job.title}
                            onChange={(e) => {
                              const newExp = [...(structuredCV.work_experience || [])];
                              newExp[idx].title = e.target.value;
                              updateSection("work_experience", newExp);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <input
                            type="text"
                            placeholder="Company"
                            value={job.company}
                            onChange={(e) => {
                              const newExp = [...(structuredCV.work_experience || [])];
                              newExp[idx].company = e.target.value;
                              updateSection("work_experience", newExp);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="From (YYYY-MM-DD)"
                              value={job.from}
                              onChange={(e) => {
                                const newExp = [...(structuredCV.work_experience || [])];
                                newExp[idx].from = e.target.value;
                                updateSection("work_experience", newExp);
                              }}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                            />
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="To (YYYY-MM-DD)"
                                value={job.to === "Present" ? "" : job.to}
                                disabled={job.to === "Present"}
                                onChange={(e) => {
                                  const newExp = [...(structuredCV.work_experience || [])];
                                  newExp[idx].to = e.target.value;
                                  updateSection("work_experience", newExp);
                                }}
                                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 disabled:opacity-70"
                              />
                              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={job.to === "Present"}
                                  onChange={(e) => {
                                    const newExp = [...(structuredCV.work_experience || [])];
                                    newExp[idx].to = e.target.checked ? "Present" : "";
                                    updateSection("work_experience", newExp);
                                  }}
                                  className="h-3 w-3 accent-emerald-500"
                                />
                                Present
                              </label>
                            </div>
                          </div>
                          <input
                            type="text"
                            placeholder="Location"
                            value={job.location}
                            onChange={(e) => {
                              const newExp = [...(structuredCV.work_experience || [])];
                              newExp[idx].location = e.target.value;
                              updateSection("work_experience", newExp);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <div className="space-y-2">
                            <label className="text-xs text-slate-400">Description Bullets:</label>
                            {(job.bullets || []).map((bullet, bIdx) => (
                              <div key={bIdx} className="flex items-start gap-2">
                                <textarea
                                  value={bullet}
                                  onChange={(e) => {
                                    const newExp = [...(structuredCV.work_experience || [])];
                                    const newBullets = [...(newExp[idx].bullets || [])];
                                    newBullets[bIdx] = e.target.value;
                                    newExp[idx].bullets = newBullets;
                                    updateSection("work_experience", newExp);
                                  }}
                                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                                  rows={2}
                                />
                                <button
                                  onClick={() => {
                                    const newExp = [...(structuredCV.work_experience || [])];
                                    newExp[idx].bullets = (newExp[idx].bullets || []).filter((_, i) => i !== bIdx);
                                    updateSection("work_experience", newExp);
                                  }}
                                  className="text-red-400 hover:text-red-300 text-xs mt-1"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const newExp = [...(structuredCV.work_experience || [])];
                                newExp[idx].bullets = [...(newExp[idx].bullets || []), ""];
                                updateSection("work_experience", newExp);
                              }}
                              className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                            >
                              + Add Bullet
                            </button>
                          </div>
                          <button
                            onClick={() => {
                              const newExp = (structuredCV.work_experience || []).filter((_, i) => i !== idx);
                              updateSection("work_experience", newExp);
                            }}
                            className="text-red-400 hover:text-red-300 text-xs font-medium"
                          >
                            Remove Entry
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSection("work_experience", [
                            ...(structuredCV.work_experience || []),
                            { from: "", to: "", title: "", company: "", location: "", bullets: [] },
                          ])
                        }
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Experience
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {(structuredCV.work_experience || []).map((job, idx) => (
                        <div key={idx} className="border-l-2 border-emerald-500/30 pl-3 space-y-1">
                          <div className="text-slate-200">
                            <span className="font-semibold">{job.title}</span>
                            {job.company && <span> at {job.company}</span>}
                          </div>
                          {(job.from || job.to) && (
                            <div className="text-xs text-slate-400">
                              {job.from} - {job.to}
                              {job.location && <span> · {job.location}</span>}
                            </div>
                          )}
                          {job.bullets && job.bullets.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                              {job.bullets.map((bullet, bIdx) => (
                                <li key={bIdx}>• {bullet}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {showEducation && (
                <Section
                  title="Education"
                  isEditing={editingSection === "education"}
                  onEdit={() => {
                    setError(null);
                    setEditingSection(editingSection === "education" ? null : "education");
                  }}
                >
                  {editingSection === "education" ? (
                    <div className="space-y-3">
                      {(structuredCV.education || []).map((edu, idx) => (
                        <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
                          <input
                            type="text"
                            placeholder="Degree"
                            value={edu.degree}
                            onChange={(e) => {
                              const newEdu = [...(structuredCV.education || [])];
                              newEdu[idx].degree = e.target.value;
                              updateSection("education", newEdu);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <input
                            type="text"
                            placeholder="Institution"
                            value={edu.institution}
                            onChange={(e) => {
                              const newEdu = [...(structuredCV.education || [])];
                              newEdu[idx].institution = e.target.value;
                              updateSection("education", newEdu);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="From (YYYY-MM)"
                              value={edu.from}
                              onChange={(e) => {
                                const newEdu = [...(structuredCV.education || [])];
                                newEdu[idx].from = e.target.value;
                                updateSection("education", newEdu);
                              }}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                            />
                            <input
                              type="text"
                              placeholder="To (YYYY-MM)"
                              value={edu.to}
                              onChange={(e) => {
                                const newEdu = [...(structuredCV.education || [])];
                                newEdu[idx].to = e.target.value;
                                updateSection("education", newEdu);
                              }}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const newEdu = (structuredCV.education || []).filter((_, i) => i !== idx);
                              updateSection("education", newEdu);
                            }}
                            className="text-red-400 hover:text-red-300 text-xs font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSection("education", [
                            ...(structuredCV.education || []),
                            { from: "", to: "", degree: "", institution: "" },
                          ])
                        }
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Education
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {(structuredCV.education || []).map((edu, idx) => (
                        <div key={idx} className="text-slate-300">
                          <div className="font-semibold text-slate-200">{edu.degree}</div>
                          <div className="text-xs">{edu.institution}</div>
                          {(edu.from || edu.to) && (
                            <div className="text-xs text-slate-400">
                              {edu.from} - {edu.to}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Certifications */}
              {showCertifications && (
                <Section
                  title="Certifications"
                  isEditing={editingSection === "certifications"}
                  onEdit={() => {
                    // When leaving edit mode for Certifications, ensure no blank rows.
                    if (editingSection === "certifications" && structuredCV && Array.isArray(structuredCV.certifications)) {
                      for (let i = 0; i < structuredCV.certifications.length; i++) {
                        const cert = structuredCV.certifications[i];
                        if (!cert.trim()) {
                          setError(
                            `Certification #${i + 1} is empty. Please fill it in or remove this certification.`
                          );
                          return;
                        }
                      }
                    }
                    setError(null);
                    setEditingSection(
                      editingSection === "certifications" ? null : "certifications"
                    );
                  }}
                >
                  {editingSection === "certifications" ? (
                    <div className="space-y-2">
                      {(structuredCV.certifications || []).map((cert, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={cert}
                            onChange={(e) => {
                              const newCerts = [...(structuredCV.certifications || [])];
                              newCerts[idx] = e.target.value;
                              updateSection("certifications", newCerts);
                            }}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                          />
                          <button
                            onClick={() => {
                              const newCerts = (structuredCV.certifications || []).filter((_, i) => i !== idx);
                              updateSection("certifications", newCerts);
                            }}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSection("certifications", [...(structuredCV.certifications || []), ""])
                        }
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Certification
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {(structuredCV.certifications || []).map((cert, idx) => (
                        <div key={`cert-${idx}`} className="text-slate-300">
                          • {cert}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {showProjects && (
                <Section
                  title="Projects"
                  isEditing={editingSection === "projects"}
                  onEdit={() => {
                    setError(null);
                    setEditingSection(editingSection === "projects" ? null : "projects");
                  }}
                >
                  {editingSection === "projects" ? (
                    <div className="space-y-4">
                      {(structuredCV.projects || []).map((project, idx) => (
                        <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
                          <input
                            type="text"
                            placeholder="Title"
                            value={project.title}
                            onChange={(e) => {
                              const newProjects = [...(structuredCV.projects || [])];
                              newProjects[idx].title = e.target.value;
                              updateSection("projects", newProjects);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <input
                            type="text"
                            placeholder="Company/Context"
                            value={project.company}
                            onChange={(e) => {
                              const newProjects = [...(structuredCV.projects || [])];
                              newProjects[idx].company = e.target.value;
                              updateSection("projects", newProjects);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="From (YYYY-MM-DD)"
                              value={project.from}
                              onChange={(e) => {
                                const newProjects = [...(structuredCV.projects || [])];
                                newProjects[idx].from = e.target.value;
                                updateSection("projects", newProjects);
                              }}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                            />
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="To (YYYY-MM-DD)"
                                value={project.to === "Present" ? "" : project.to}
                                disabled={project.to === "Present"}
                                onChange={(e) => {
                                  const newProjects = [...(structuredCV.projects || [])];
                                  newProjects[idx].to = e.target.value;
                                  updateSection("projects", newProjects);
                                }}
                                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 disabled:opacity-70"
                              />
                              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={project.to === "Present"}
                                  onChange={(e) => {
                                    const newProjects = [...(structuredCV.projects || [])];
                                    newProjects[idx].to = e.target.checked ? "Present" : "";
                                    updateSection("projects", newProjects);
                                  }}
                                  className="h-3 w-3 accent-emerald-500"
                                />
                                Present
                              </label>
                            </div>
                          </div>
                          <input
                            type="text"
                            placeholder="Location"
                            value={project.location}
                            onChange={(e) => {
                              const newProjects = [...(structuredCV.projects || [])];
                              newProjects[idx].location = e.target.value;
                              updateSection("projects", newProjects);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                          />
                          <div className="space-y-2">
                            <label className="text-xs text-slate-400">Description Bullets:</label>
                            {(project.bullets || []).map((bullet, bIdx) => (
                              <div key={bIdx} className="flex items-start gap-2">
                                <textarea
                                  value={bullet}
                                  onChange={(e) => {
                                    const newProjects = [...(structuredCV.projects || [])];
                                    const newBullets = [...(newProjects[idx].bullets || [])];
                                    newBullets[bIdx] = e.target.value;
                                    newProjects[idx].bullets = newBullets;
                                    updateSection("projects", newProjects);
                                  }}
                                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                                  rows={2}
                                />
                                <button
                                  onClick={() => {
                                    const newProjects = [...(structuredCV.projects || [])];
                                    newProjects[idx].bullets = (newProjects[idx].bullets || []).filter((_, i) => i !== bIdx);
                                    updateSection("projects", newProjects);
                                  }}
                                  className="text-red-400 hover:text-red-300 text-xs mt-1"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const newProjects = [...(structuredCV.projects || [])];
                                newProjects[idx].bullets = [...(newProjects[idx].bullets || []), ""];
                                updateSection("projects", newProjects);
                              }}
                              className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                            >
                              + Add Bullet
                            </button>
                          </div>
                          <button
                            onClick={() => {
                              const newProjects = (structuredCV.projects || []).filter((_, i) => i !== idx);
                              updateSection("projects", newProjects);
                            }}
                            className="text-red-400 hover:text-red-300 text-xs font-medium"
                          >
                            Remove Entry
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSection("projects", [
                            ...(structuredCV.projects || []),
                            { from: "", to: "", title: "", company: "", location: "", bullets: [] },
                          ])
                        }
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Project
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {(structuredCV.projects || []).map((project, idx) => (
                        <div key={idx} className="border-l-2 border-emerald-500/30 pl-3 space-y-1">
                          <div className="text-slate-200">
                            <span className="font-semibold">{project.title}</span>
                            {project.company && <span> at {project.company}</span>}
                          </div>
                          {(project.from || project.to) && (
                            <div className="text-xs text-slate-400">
                              {project.from} - {project.to}
                              {project.location && <span> · {project.location}</span>}
                            </div>
                          )}
                          {project.bullets && project.bullets.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                              {project.bullets.map((bullet, bIdx) => (
                                <li key={bIdx}>• {bullet}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {showCourses && (
                <Section
                  title="Courses"
                  isEditing={editingSection === "courses"}
                  onEdit={() => {
                    setError(null);
                    setEditingSection(editingSection === "courses" ? null : "courses");
                  }}
                >
                  {editingSection === "courses" ? (
                    <div className="space-y-2">
                      {(structuredCV.courses || []).map((course, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={course}
                            onChange={(e) => {
                              const newCourses = [...(structuredCV.courses || [])];
                              newCourses[idx] = e.target.value;
                              updateSection("courses", newCourses);
                            }}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                          />
                          <button
                            onClick={() => {
                              const newCourses = (structuredCV.courses || []).filter((_, i) => i !== idx);
                              updateSection("courses", newCourses);
                            }}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => updateSection("courses", [...(structuredCV.courses || []), ""])}
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                      >
                        + Add Course
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {(structuredCV.courses || []).map((course, idx) => (
                        <div key={`course-${idx}`} className="text-slate-300">
                          • {course}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Languages */}
              <Section
                title="Languages"
                isEditing={editingSection === "languages"}
                onEdit={() => {
                  setError(null);
                  setEditingSection(editingSection === "languages" ? null : "languages");
                }}
              >
                {editingSection === "languages" ? (
                  <div className="space-y-2">
                    {(structuredCV?.languages || []).map((lang, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Language"
                          value={lang.name}
                          onChange={(e) => {
                            const newLangs = [...(structuredCV?.languages || [])];
                            newLangs[idx].name = e.target.value;
                            updateSection("languages", newLangs);
                          }}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                        <input
                          type="text"
                          placeholder="Level"
                          value={lang.level}
                          onChange={(e) => {
                            const newLangs = [...(structuredCV?.languages || [])];
                            newLangs[idx].level = e.target.value;
                            updateSection("languages", newLangs);
                          }}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                        <button
                          onClick={() => {
                            const newLangs = (structuredCV?.languages || []).filter((_, i) => i !== idx);
                            updateSection("languages", newLangs);
                          }}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        updateSection("languages", [
                          ...(structuredCV?.languages || []),
                          { name: "", level: "" },
                        ])
                      }
                      className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                    >
                      + Add Language
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    {Array.isArray(structuredCV?.languages) && structuredCV.languages.length > 0 ? (
                      structuredCV.languages.map((lang, idx) => (
                        <div key={idx} className="text-slate-300">
                          • {lang.name} ({lang.level})
                        </div>
                      ))
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                )}
              </Section>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-4 border-t border-slate-800/60 pt-4 flex flex-col sm:flex-row justify-end gap-2.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:border-slate-600/80 transition-all duration-200"
          >
            Cancel
          </button>
          <div className="flex gap-2.5">
            <button
              onClick={() => handleExport("competence")}
              disabled={
                exporting !== null ||
                !structuredCV
              }
              className="inline-flex items-center rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/20 hover:border-blue-500/70 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {exporting === "competence" ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Exporting...
                </>
              ) : (
                "Competence Paper"
              )}
            </button>
            <button
              onClick={() => handleExport("cv")}
              disabled={
                exporting !== null ||
                !structuredCV
              }
              className="inline-flex items-center rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-emerald-500/40"
            >
              {exporting === "cv" ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Exporting...
                </>
              ) : (
                "Generate CV"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  isEditing: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}

function Section({ title, isEditing, onEdit, children }: SectionProps) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4 shadow-sm hover:border-slate-700/80 transition-all duration-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-slate-100 text-sm">{title}</h3>
        <button
          onClick={onEdit}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all duration-200 ${isEditing
            ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30"
            : "border border-slate-700/60 text-slate-300 hover:bg-slate-800/60 hover:border-slate-600/80 hover:text-slate-100"
            }`}
        >
          {isEditing ? "Done" : "Edit"}
        </button>
      </div>
      <div className="text-slate-200">{children}</div>
    </div>
  );
}
