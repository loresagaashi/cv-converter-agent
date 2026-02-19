export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
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
  courses: string[];
  languages: LanguageItem[];
}


