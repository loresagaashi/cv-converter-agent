export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
  last_login?: string | null;
  /**
   * Simple role string derived from the backend:
   * - "admin"  -> full dashboard access and user management
   * - "user"   -> regular access
   */
  role: "admin" | "user";
}

export interface AuthResponse extends User {
  access_token: string;
}

export interface CV {
  id: number;
  original_filename: string;
  uploaded_at: string;
  file?: string;
  uploaded_by?: string;
  competence_summary?: string;
  skills?: string[];
}

export interface CVTextResponse {
  id: number;
  original_filename: string;
  uploaded_at: string;
  text: string;
}

export interface ConvertCVResponse {
  source: {
    cv_id: number | null;
    original_filename: string | null;
  };
  competence_summary: string;
  skills: string[];
}

// Structured CV types for modal editing
export interface WorkExperienceItem {
  from: string;
  to: string;
  title: string;
  company: string;
  location: string;
  bullets: string[];
}

export interface EducationItem {
  from: string;
  to: string;
  degree: string;
  institution: string;
}

export interface ProjectItem {
  from: string;
  to: string;
  title: string;
  company: string;
  location: string;
  bullets: string[];
}

export interface LanguageItem {
  name: string;
  level: string;
}

export interface StructuredCV {
  profile: string;
  work_experience: WorkExperienceItem[];
  certifications: string[];
  education: EducationItem[];
  projects: ProjectItem[];
  skills: string[];
  core_skills: string[];
  soft_skills: string[];
  courses: string[];
  languages: LanguageItem[];
}

// Pagination response wrapper
export interface PaginatedResponse<T> {
  data: T[];
  totalRecords: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface UserSession {
  id: number;
  user_id: number;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
  created_at: string;
  expires_at: string;
}

// Vector Search types
export interface VectorMatchCandidate {
  id: string;
  name: string;
  current_title: string;
  stated_seniority: string;
  inferred_competency: string;
  years_of_experience: number;
  vector_similarity: number;
  skill_overlap: {
    matched_required: string[];
    missing_required: string[];
    matched_preferred: string[];
    required_coverage: number;
    total_score: number;
  };
  composite_score: number;
  search_tier: number;
  competency_note: string;
  gap_analysis?: string;
}

export interface VectorMatchRequest {
  job_description: string;
  top_k: number;
  include_gap_analysis: boolean;
}

export interface VectorMatchResponse {
  parsed_jd: {
    title: string;
    seniority: string;
    required_skills: string[];
    preferred_skills: string[];
    min_years_experience: number;
  };
  candidates: VectorMatchCandidate[];
  total_results: number;
}

export interface VectorSearchStatus {
  indexed_count: number;
  total_cvs: number;
  chroma_ready: boolean;
}

