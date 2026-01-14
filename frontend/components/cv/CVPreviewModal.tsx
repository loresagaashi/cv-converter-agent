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
  // Profile: must not be completely empty (if provided by the API)
  if (typeof cv.profile === "string" && !cv.profile.trim()) {
    return "Profile section cannot be empty. Please add a short professional summary.";
  }

  // Generic rule for string-array sections (no empty items).
  // It's OK for a section to be completely missing (empty array) –
  // we only validate rows that actually exist.
  const stringArraySections: Array<{
    itemLabel: string;
    items?: string[];
  }> = [
    { itemLabel: "Skill", items: cv.skills },
    { itemLabel: "Certification", items: cv.certifications },
    { itemLabel: "Course", items: cv.courses },
  ];

  for (const section of stringArraySections) {
    if (!Array.isArray(section.items) || section.items.length === 0) continue;
    for (let i = 0; i < section.items.length; i++) {
      const value = (section.items[i] || "").trim();
      if (!value) {
        return `${section.itemLabel} #${i + 1} is empty. Please fill it in or remove it.`;
      }
    }
  }

  // Work experience: if any field in an entry is filled, require the key fields
  for (let i = 0; i < (cv.work_experience?.length || 0); i++) {
    const job = cv.work_experience![i];
    const hasTitle = (job.title || "").trim();
    const hasCompany = (job.company || "").trim();
    const hasAny =
      hasTitle ||
      hasCompany ||
      (job.from || "").trim() ||
      (job.to || "").trim() ||
      (job.location || "").trim();

    if (hasAny) {
      // Only require title and company if user is actively filling the entry
      if ((hasTitle && !hasCompany) || (!hasTitle && hasCompany)) {
        return `Please fill both Title and Company for work experience #${i + 1}, or remove the entry.`;
      }
      
      // Date validation is optional - only validate ordering if both dates exist
      const jobFrom = job.from || "";
      const jobTo = job.to || "";
      if (jobFrom && jobTo && jobTo !== "Present") {
        const fromDate = new Date(jobFrom);
        const toDate = new Date(jobTo);
        if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime()) && toDate < fromDate) {
          return `End date must be after start date for work experience #${i + 1}.`;
        }
      }
    }
  }

  // Education: same generic "no partial entry" rule + at least one entry
  for (let i = 0; i < (cv.education?.length || 0); i++) {
    const edu = cv.education![i];
    const hasAny = (edu.degree || "").trim() || (edu.institution || "").trim();
    if (hasAny) {
      if (!(edu.degree || "").trim() || !(edu.institution || "").trim()) {
        return `Please fill both Degree and Institution for education entry #${i + 1}, or remove the entry.`;
      }
    }
  }

  // Certifications: do not allow empty rows
  for (let i = 0; i < (cv.certifications?.length || 0); i++) {
    if (!(cv.certifications![i] || "").trim()) {
      return `Certification #${i + 1} is empty. Please fill it in or remove this certification.`;
    }
  }

  // Courses: do not allow empty rows
  for (let i = 0; i < (cv.courses?.length || 0); i++) {
    if (!(cv.courses![i] || "").trim()) {
      return `Course #${i + 1} is empty. Please fill it in or remove this course.`;
    }
  }

  // Projects: same generic "no partial entry" rule as work experience
  for (let i = 0; i < (cv.projects?.length || 0); i++) {
    const project = cv.projects![i];
    const hasTitle = (project.title || "").trim();
    const hasCompany = (project.company || "").trim();
    const hasAny =
      hasTitle ||
      hasCompany ||
      (project.from || "").trim() ||
      (project.to || "").trim() ||
      (project.location || "").trim();
    if (hasAny) {
      // Only require title and company if user is actively filling the entry
      if ((hasTitle && !hasCompany) || (!hasTitle && hasCompany)) {
        return `Please fill both Title and Company for project #${i + 1}, or remove the entry.`;
      }
      
      // Date validation is optional - only validate ordering if both dates exist
      const projectFrom = project.from || "";
      const projectTo = project.to || "";
      if (projectFrom && projectTo && projectTo !== "Present") {
        const fromDate = new Date(projectFrom);
        const toDate = new Date(projectTo);
        if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime()) && toDate < fromDate) {
          return `End date must be after start date for project #${i + 1}.`;
        }
      }
    }
  }

  // Languages: ensure both name and level are filled if entry exists
  for (let i = 0; i < (cv.languages?.length || 0); i++) {
    const lang = cv.languages![i];
    const hasAny = (lang.name || "").trim() || (lang.level || "").trim();
    if (hasAny) {
      if (!(lang.name || "").trim() || !(lang.level || "").trim()) {
        return `Please fill both Name and Level for language #${i + 1}, or remove the entry.`;
      }
    }
  }

  return null;
}

export function CVPreviewModal({ cvId, token, isOpen, onClose, originalFilename }: Props) {
  const [structuredCV, setStructuredCV] = useState<StructuredCVPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editingSection, setEditingSection] = useState<EditingSection | null>(null);

  // Load structured CV when modal opens - always reload to get fresh data
  const loadStructuredCV = useCallback(async () => {
    if (!isOpen || !token) return;
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
    } catch (err: any) {
      setError(err?.message || "Failed to load CV structure");
    } finally {
      setLoading(false);
    }
  }, [cvId, token, isOpen]);

  // Always reload when modal opens to get fresh data
  useEffect(() => {
    if (isOpen && token) {
      loadStructuredCV();
    }
  }, [isOpen, cvId, token, loadStructuredCV]);

  const handleExport = async () => {
    if (!structuredCV || !token) return;

    // Validate before exporting
    const validationError = validateStructuredCV(structuredCV);
    if (validationError) {
      setError(validationError);
      return;
    }

    setExporting(true);
    setError(null);
    try {
      // Cast to StructuredCV since we've validated all required fields exist
      const blob = await exportEditedCV(cvId, token, structuredCV as StructuredCV);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = originalFilename?.replace(/\.[^/.]+$/, "") || `cv_${cvId}`;
      a.download = `${baseName}_formatted_CV.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Failed to export CV");
    } finally {
      setExporting(false);
    }
  };

  const updateSection = (section: EditingSection, value: any) => {
    if (!structuredCV) return;
    setStructuredCV({
      ...structuredCV,
      [section]: value,
    });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-h-[90vh] max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">Preview & Edit CV</h2>
            <p className="text-xs text-slate-400 mt-1">
              Review and edit sections, then export as PDF with your changes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-slate-400 text-sm">Loading CV structure...</div>
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
                    <textarea
                      value={structuredCV.profile as string}
                      onChange={(e) => updateSection("profile", e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={3}
                    />
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
                    // When leaving edit mode for Work Experience, ensure required fields are filled
                    if (editingSection === "work_experience" && structuredCV && Array.isArray(structuredCV.work_experience)) {
                      for (let i = 0; i < structuredCV.work_experience.length; i++) {
                        const job = structuredCV.work_experience[i];
                        const hasTitle = (job.title || "").trim();
                        const hasCompany = (job.company || "").trim();
                        const hasAny =
                          hasTitle ||
                          hasCompany ||
                          (job.from || "").trim() ||
                          (job.to || "").trim() ||
                          (job.location || "").trim();

                        if (hasAny) {
                          // Only require title and company consistency
                          if ((hasTitle && !hasCompany) || (!hasTitle && hasCompany)) {
                            setError(
                              `Please fill both Title and Company for work experience #${i + 1}, or remove the entry.`
                            );
                            return;
                          }

                          // Date validation is optional - only validate ordering if both dates exist
                          const jobFrom = job.from || "";
                          const jobTo = job.to || "";
                          if (jobFrom && jobTo && jobTo !== "Present") {
                            const fromDate = new Date(jobFrom);
                            const toDate = new Date(jobTo);
                            if (
                              !isNaN(fromDate.getTime()) &&
                              !isNaN(toDate.getTime()) &&
                              toDate < fromDate
                            ) {
                              setError(
                                `End date must be after start date for work experience #${i + 1}.`
                              );
                              return;
                            }
                          }
                        }
                      }
                    }
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
                    // When leaving edit mode for Education, enforce generic rules
                    if (editingSection === "education" && structuredCV && Array.isArray(structuredCV.education)) {
                      for (let i = 0; i < structuredCV.education.length; i++) {
                        const edu = structuredCV.education[i];
                        const hasAny = (edu.degree || "").trim() || (edu.institution || "").trim();
                        if (hasAny) {
                          if (!edu.degree.trim() || !edu.institution.trim()) {
                            setError(
                              `Please fill both Degree and Institution for education entry #${i + 1}, or remove the entry.`
                            );
                            return;
                          }
                        }
                      }
                    }
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
                    // When leaving edit mode for Projects, ensure required fields are filled
                    if (editingSection === "projects" && structuredCV && Array.isArray(structuredCV.projects)) {
                      for (let i = 0; i < structuredCV.projects.length; i++) {
                        const project = structuredCV.projects[i];
                        const hasTitle = (project.title || "").trim();
                        const hasCompany = (project.company || "").trim();
                        const hasAny =
                          hasTitle ||
                          hasCompany ||
                          (project.from || "").trim() ||
                          (project.to || "").trim() ||
                          (project.location || "").trim();
                        if (hasAny) {
                          // Only require title and company consistency
                          if ((hasTitle && !hasCompany) || (!hasTitle && hasCompany)) {
                            setError(
                              `Please fill both Title and Company for project #${i + 1}, or remove the entry.`
                            );
                            return;
                          }
                          
                          // Date validation is optional - only validate ordering if both dates exist
                          const projectFrom = project.from || "";
                          const projectTo = project.to || "";
                          if (projectFrom && projectTo && projectTo !== "Present") {
                            const fromDate = new Date(projectFrom);
                            const toDate = new Date(projectTo);
                            if (
                              !isNaN(fromDate.getTime()) &&
                              !isNaN(toDate.getTime()) &&
                              toDate < fromDate
                            ) {
                              setError(
                                `End date must be after start date for project #${i + 1}.`
                              );
                              return;
                            }
                          }
                        }
                      }
                    }
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
                    // When leaving edit mode for Courses, ensure no blank rows.
                    if (editingSection === "courses" && structuredCV && Array.isArray(structuredCV.courses)) {
                      for (let i = 0; i < structuredCV.courses.length; i++) {
                        const course = structuredCV.courses[i];
                        if (!course.trim()) {
                          setError(
                            `Course #${i + 1} is empty. Please fill it in or remove this course.`
                          );
                          return;
                        }
                      }
                    }
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
                  // When leaving edit mode for Languages, ensure no blank rows.
                  if (editingSection === "languages" && structuredCV) {
                    for (let i = 0; i < structuredCV.languages.length; i++) {
                      const lang = structuredCV.languages[i];
                      if (!lang.name.trim() || !lang.level.trim()) {
                        setError(
                          `Please fill both Name and Level for language #${i + 1}, or remove the entry.`
                        );
                        return;
                      }
                    }
                  }
                  setError(null);
                  setEditingSection(editingSection === "languages" ? null : "languages");
                }}
              >
                {editingSection === "languages" ? (
                  <div className="space-y-2">
                    {structuredCV.languages.map((lang, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Language"
                          value={lang.name}
                          onChange={(e) => {
                            const newLangs = [...structuredCV.languages];
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
                            const newLangs = [...structuredCV.languages];
                            newLangs[idx].level = e.target.value;
                            updateSection("languages", newLangs);
                          }}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                        <button
                          onClick={() => {
                            const newLangs = structuredCV.languages.filter((_, i) => i !== idx);
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
                          ...structuredCV.languages,
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
                    {structuredCV.languages.length > 0 ? (
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
        <div className="mt-4 border-t border-slate-800 pt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
          >
            Close
          </button>
          <button
            onClick={handleExport}
            disabled={
              exporting ||
              !structuredCV ||
              !!(structuredCV && validateStructuredCV(structuredCV))
            }
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? "Exporting..." : "Export to PDF"}
          </button>
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
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-slate-100 text-sm">{title}</h3>
        <button
          onClick={onEdit}
          className={`text-xs px-2 py-1 rounded ${
            isEditing
              ? "bg-emerald-500 text-slate-950 font-medium"
              : "border border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          {isEditing ? "Done" : "Edit"}
        </button>
      </div>
      <div className="text-slate-200">{children}</div>
    </div>
  );
}
