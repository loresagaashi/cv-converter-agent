export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
}

export interface AuthResponse extends User {
  token: string;
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


