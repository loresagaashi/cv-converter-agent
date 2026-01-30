import { AuthResponse, CV, CVTextResponse, ConvertCVResponse, User, StructuredCV } from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      // Handle Django REST framework error formats
      if (data?.non_field_errors && Array.isArray(data.non_field_errors)) {
        detail = data.non_field_errors[0];
      } else if (data?.detail) {
        detail = data.detail;
      } else if (typeof data === 'string') {
        detail = data;
      } else {
        // Fallback: show a generic message instead of raw JSON
        detail = "An error occurred. Please try again.";
      }
    } catch {
      // ignore JSON parsing error
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/users/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return handleResponse<AuthResponse>(res);
}

export async function signup(payload: {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/users/signup/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleResponse<AuthResponse>(res);
}

export async function getCurrentUser(token: string): Promise<User> {
  const res = await fetch(`${API_BASE_URL}/api/users/me/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<User>(res);
}

// ---------------------------------------------------------------------------
// Admin user management (RBAC-protected)
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "user";

export interface AdminUserPayload {
  email: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role: UserRole;
}

export interface AdminUserUpdatePayload {
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: UserRole;
}

export async function listUsers(token: string): Promise<User[]> {
  const res = await fetch(`${API_BASE_URL}/api/users/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<User[]>(res);
}

export async function createUser(
  token: string,
  payload: AdminUserPayload
): Promise<User> {
  const res = await fetch(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse<User>(res);
}

export async function updateUser(
  token: string,
  id: number,
  payload: AdminUserUpdatePayload
): Promise<User> {
  const res = await fetch(`${API_BASE_URL}/api/users/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse<User>(res);
}

export async function deleteUser(token: string, id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/users/${id}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    await handleResponse(res as Response);
  }
}

export async function listCVs(token: string): Promise<CV[]> {
  const res = await fetch(`${API_BASE_URL}/api/cv/upload/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<CV[]>(res);
}

export async function deleteCV(id: number, token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/cv/${id}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    await handleResponse(res as Response);
  }
}

export async function uploadCV(
  file: File,
  token: string
): Promise<CV> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/cv/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
    },
    body: formData,
  });

  return handleResponse<CV>(res);
}

export async function getCVText(
  id: number,
  token: string
): Promise<CVTextResponse> {
  const res = await fetch(`${API_BASE_URL}/api/cv/${id}/text/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<CVTextResponse>(res);
}

export async function convertCV(
  id: number,
  token: string
): Promise<ConvertCVResponse> {
  const res = await fetch(`${API_BASE_URL}/api/convert/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cv_id: id }),
  });

  return handleResponse<ConvertCVResponse>(res);
}

export async function downloadFormattedCV(
  id: number,
  token: string
): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/cv/${id}/formatted/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      // DRF usually returns {"detail": "..."}
      detail = (data?.detail as string) || JSON.stringify(data);
    } catch {
      // ignore JSON parsing errors for non-JSON responses
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  return res.blob();
}

export async function getStructuredCV(
  id: number,
  token: string
): Promise<StructuredCV> {
  const res = await fetch(`${API_BASE_URL}/api/cv/${id}/structured/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<StructuredCV>(res);
}


export interface CompetencePaper {
  id: number;
  cv_id: number;
  paper_type: "original" | "interview_based";
  content: string;
  created_at: string;
  preview?: string;
}

export interface CompetencePaperListResponse {
  cv_id: number;
  papers: CompetencePaper[];
  count: number;
}

export async function getCompetencePapers(
  cvId: number,
  token: string
): Promise<CompetencePaperListResponse> {
  const res = await fetch(`${API_BASE_URL}/api/interview/competence-papers/${cvId}/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<CompetencePaperListResponse>(res);
}

export async function getCompetencePaper(
  paperId: number,
  token: string
): Promise<CompetencePaper> {
  const res = await fetch(`${API_BASE_URL}/api/interview/competence-paper/${paperId}/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<CompetencePaper>(res);
}

export interface CompetencePaperWithCV extends CompetencePaper {
  cv_filename: string;
  user_email?: string;
  user_name?: string;
}

export interface AllCompetencePapersResponse {
  papers: CompetencePaperWithCV[];
  count: number;
}

export async function getAllCompetencePapers(
  token: string
): Promise<AllCompetencePapersResponse> {
  const res = await fetch(`${API_BASE_URL}/api/interview/competence-papers/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<AllCompetencePapersResponse>(res);
}

export async function deleteCompetencePaper(
  paperId: number,
  token: string
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/interview/competence-paper/${paperId}/delete/`, {
    method: "DELETE",
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = (data?.detail as string) || "Failed to delete competence paper";
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }
}

// Conversation-based competence papers
export interface ConversationCompetencePaper {
  id: number;
  cv_id: number;
  session_id: number;
  paper_type: "conversation_based";
  content: string;
  created_at: string;
  preview?: string;
  cv_filename?: string;
  user_email?: string;
  user_name?: string;
}

export interface ConversationCompetencePaperWithCV extends ConversationCompetencePaper {
  cv_filename: string;
  user_email?: string;
  user_name?: string;
}

export interface AllConversationCompetencePapersResponse {
  papers: ConversationCompetencePaperWithCV[];
  count: number;
}

export async function getAllConversationCompetencePapers(
  token: string
): Promise<AllConversationCompetencePapersResponse> {
  const res = await fetch(`${API_BASE_URL}/api/interview/conversation-competence-papers/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<AllConversationCompetencePapersResponse>(res);
}

export async function getConversationCompetencePaper(
  paperId: number,
  token: string
): Promise<ConversationCompetencePaper> {
  const res = await fetch(`${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  return handleResponse<ConversationCompetencePaper>(res);
}

export async function deleteConversationCompetencePaper(
  paperId: number,
  token: string
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/delete/`, {
    method: "DELETE",
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = (data?.detail as string) || "Failed to delete conversation competence paper";
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }
}

export async function exportEditedCV(
  id: number,
  token: string,
  structuredCV: StructuredCV,
  sectionOrder?: string[],
  type: "cv" | "competence" = "cv"
): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/cv/${id}/structured/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structured_cv: structuredCV,
      section_order: sectionOrder,
      type,
    }),
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = (data?.detail as string) || JSON.stringify(data);
    } catch {
      // ignore JSON parsing errors
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  return res.blob();
}

// ---------------------------------------------------------------------------
// Conversation sessions (voice-based verification flow)
// ---------------------------------------------------------------------------

export interface ConversationSessionStartResponse {
  session_id: number;
  status: "pending" | "in_progress" | "completed";
}

export async function startConversationSession(
  token: string,
  cvId: number,
  paperId: number
): Promise<ConversationSessionStartResponse> {
  const res = await fetch(`${API_BASE_URL}/api/interview/conversation-session/start/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ cv_id: cvId, paper_id: paperId }),
  });

  return handleResponse<ConversationSessionStartResponse>(res);
}

export interface ConversationTurnPayload {
  session_id: number;
  section: string;
  phase?: "validation" | "discovery";
  question_text: string;
  answer_text: string;
}

export interface ConversationTurnResponse {
  question_id: number;
  response_id: number;
  status: "confirmed" | "partially_confirmed" | "not_confirmed" | "new_skill";
  confidence_level: "high" | "medium" | "low" | null;
  extracted_skills: string[];
}

export async function createConversationTurn(
  token: string,
  payload: ConversationTurnPayload
): Promise<ConversationTurnResponse> {
  const res = await fetch(`${API_BASE_URL}/api/interview/conversation-session/turn/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse<ConversationTurnResponse>(res);
}

export async function generateConversationCompetencePaper(
  token: string,
  sessionId: number
): Promise<ConversationCompetencePaperWithCV> {
  const res = await fetch(
    `${API_BASE_URL}/api/interview/conversation-session/${sessionId}/generate-paper/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
      },
    }
  );

  return handleResponse<ConversationCompetencePaperWithCV>(res);
}

export async function updateConversationCompetencePaper(
  token: string,
  paperId: number,
  content: string
): Promise<ConversationCompetencePaperWithCV> {
  const res = await fetch(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/edit/`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({ content }),
    }
  );

  return handleResponse<ConversationCompetencePaperWithCV>(res);
}

export async function downloadConversationCompetencePaperPdf(
  token: string,
  paperId: number
): Promise<Blob> {
  const res = await fetch(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/pdf/`,
    {
      headers: {
        Authorization: `Token ${token}`,
      },
    }
  );

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = (data?.detail as string) || JSON.stringify(data);
    } catch {
      // ignore JSON parsing errors
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  return res.blob();
}

// ---------------------------------------------------------------------------
// Text-to-Speech (OpenAI Emotional TTS)
// ---------------------------------------------------------------------------

export async function playTextToSpeech(text: string, token: string): Promise<HTMLAudioElement> {
  const res = await fetch(`${API_BASE_URL}/api/llm/tts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = (data?.detail as string) || JSON.stringify(data);
    } catch {
      // ignore JSON parsing errors
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  const audioBlob = await res.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);

  return audio;
}

