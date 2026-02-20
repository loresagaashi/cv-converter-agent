import { AuthResponse, CV, CVTextResponse, ConvertCVResponse, User, StructuredCV } from "./types";

function getAccessTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )access_token=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function clearAuthCookies() {
  if (typeof document === "undefined") return;
  const cookieNames = ["access_token", "refresh_token"];
  cookieNames.forEach((name) => {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  });
}

function clearAllAuthState() {
  // Clear cookies
  clearAuthCookies();
  
  // Clear localStorage
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("user");
  }
}

function showSessionExpiredMessage() {
  if (typeof document === "undefined") return;

  // Detect system theme
  const isDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Create overlay
  const overlay = document.createElement("div");
  overlay.id = "session-expired-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${isDark ? "rgba(0, 0, 0, 0.7)" : "rgba(0, 0, 0, 0.5)"};
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.3s ease-in;
    backdrop-filter: blur(4px);
  `;

  // Create message box (not blurred, sits on top)
  const messageBox = document.createElement("div");
  messageBox.style.cssText = `
    background: ${isDark ? "#1f2937" : "#ffffff"};
    border-radius: 8px;
    padding: 32px;
    box-shadow: 0 10px 25px ${isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.2)"};
    text-align: center;
    max-width: 500px;
    animation: slideUp 0.4s ease-out;
    position: relative;
    z-index: 10000;
  `;

  // Create heading
  const heading = document.createElement("h2");
  heading.textContent = "Session Expired";
  heading.style.cssText = `
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: ${isDark ? "#f3f4f6" : "#1f2937"};
  `;

  // Create message
  const message = document.createElement("p");
  message.textContent = "Your session has expired. Please log in again...";
  message.style.cssText = `
    font-size: 16px;
    color: ${isDark ? "#d1d5db" : "#6b7280"};
    margin: 0;
    line-height: 1.5;
  `;

  messageBox.appendChild(heading);
  messageBox.appendChild(message);
  overlay.appendChild(messageBox);
  document.body.appendChild(overlay);

  // Add animations to head
  if (!document.head.querySelector("style[data-session-expired]")) {
    const style = document.createElement("style");
    style.setAttribute("data-session-expired", "true");
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Auto-redirect after 4 seconds
  setTimeout(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, 4000);
}

// For production: use empty string (relative URLs proxied by Vercel)
// For local dev: use NEXT_PUBLIC_API_BASE_URL_LOCAL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL_LOCAL || "";

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

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  return res.json() as Promise<T>;
}

let isRenewing = false;

async function fetchWithAuthRetry(
  url: string,
  options?: RequestInit & { retryCount?: number }
): Promise<Response> {
  const retryCount = options?.retryCount || 0;
  const fetchOptions = { ...options };
  delete (fetchOptions as any).retryCount;

  // Refresh Authorization header from cookie before each attempt
  const token = getAccessTokenFromCookie();
  if (token && fetchOptions.headers && typeof fetchOptions.headers === 'object') {
    (fetchOptions.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  let res = await fetch(url, fetchOptions);

  // If 401 and haven't retried yet, attempt token renewal
  if (res.status === 401 && retryCount < 1) {
    // Prevent multiple simultaneous renewal attempts
    if (isRenewing) {
      // Wait for the current renewal to complete
      let attempts = 0;
      while (isRenewing && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      // Try again with new token
      return fetchWithAuthRetry(url, { ...options, retryCount: 1 });
    }

    isRenewing = true;
    try {
      await renewAccessToken();
      // Token renewed, retry original request
      isRenewing = false;
      return fetchWithAuthRetry(url, { ...options, retryCount: 1 });
    } catch (err: any) {
      isRenewing = false;
      // Renewal failed - renewAccessToken() already shows modal and handles redirect
      // Don't redirect here, let the modal timeout handle it
      return res;
    }
  }

  return res;
}

async function handleAuthenticatedResponse<T>(
  url: string,
  options?: RequestInit & { retryCount?: number }
): Promise<T> {
  const res = await fetchWithAuthRetry(url, options);
  return handleResponse<T>(res);
}

async function handleAuthenticatedBlobResponse(
  url: string,
  options?: RequestInit & { retryCount?: number }
): Promise<Blob> {
  const res = await fetchWithAuthRetry(url, options);

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
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

export async function login(email: string, password: string): Promise<AuthResponse> {
  console.log("🔥 LOGIN CALLED - API_BASE_URL:", API_BASE_URL);
  const res = await fetch(`${API_BASE_URL}/api/users/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  console.log("📥 Login response status:", res.status, res.statusText);
  
  if (!res.ok) {
    console.log("❌ Login failed with status:", res.status);
    const responseText = await res.text();
    console.log("🔴 Raw backend response:", responseText.substring(0, 1500));
    
    // Create a new Response with the text so handleResponse can parse it
    const newRes = new Response(responseText, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    return handleResponse<AuthResponse>(newRes);
  }

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
    credentials: "include",
    body: JSON.stringify(payload),
  });

  return handleResponse<AuthResponse>(res);
}

export async function logout(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/users/logout/`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore JSON parsing errors
    }
    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }
}

export async function renewAccessToken(): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/users/renew/`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    // Clear all auth state on renewal failure (token is dead)
    clearAllAuthState();
    
    let detail = "Please login again.";
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // ignore JSON parsing errors
    }

    // Show session expired message and redirect
    showSessionExpiredMessage();

    const error = new Error(detail);
    (error as any).status = res.status;
    throw error;
  }

  return handleResponse<AuthResponse>(res);
}

export async function getCurrentUser(token?: string): Promise<User> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<User>(`${API_BASE_URL}/api/users/me/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
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

export async function listUsers(token?: string): Promise<User[]> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<User[]>(`${API_BASE_URL}/api/users/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function createUser(
  payload: AdminUserPayload,
  token?: string
): Promise<User> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<User>(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  id: number,
  payload: AdminUserUpdatePayload,
  token?: string
): Promise<User> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<User>(`${API_BASE_URL}/api/users/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(id: number, token?: string): Promise<void> {
  const accessToken = getAccessTokenFromCookie() || token;
  await handleAuthenticatedResponse<void>(`${API_BASE_URL}/api/users/${id}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function listCVs(token?: string): Promise<CV[]> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<CV[]>(`${API_BASE_URL}/api/cv/upload/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function deleteCV(id: number, token?: string): Promise<void> {
  const accessToken = getAccessTokenFromCookie() || token;
  await handleAuthenticatedResponse<void>(`${API_BASE_URL}/api/cv/${id}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function uploadCV(
  file: File,
  token?: string
): Promise<CV> {
  const accessToken = getAccessTokenFromCookie() || token;
  const formData = new FormData();
  formData.append("file", file);

  return handleAuthenticatedResponse<CV>(`${API_BASE_URL}/api/cv/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
}

export async function getCVText(
  id: number,
  token?: string
): Promise<CVTextResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<CVTextResponse>(`${API_BASE_URL}/api/cv/${id}/text/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function convertCV(
  id: number,
  token?: string
): Promise<ConvertCVResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConvertCVResponse>(`${API_BASE_URL}/api/convert/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cv_id: id }),
  });
}

export async function downloadFormattedCV(
  id: number,
  token?: string
): Promise<Blob> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedBlobResponse(`${API_BASE_URL}/api/cv/${id}/formatted/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function getStructuredCV(
  id: number,
  token?: string
): Promise<StructuredCV> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<StructuredCV>(`${API_BASE_URL}/api/cv/${id}/structured/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
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
  token?: string
): Promise<CompetencePaperListResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<CompetencePaperListResponse>(
    `${API_BASE_URL}/api/interview/competence-papers/${cvId}/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function getCompetencePaper(
  paperId: number,
  token?: string
): Promise<CompetencePaper> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<CompetencePaper>(
    `${API_BASE_URL}/api/interview/competence-paper/${paperId}/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
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
  token?: string
): Promise<AllCompetencePapersResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<AllCompetencePapersResponse>(
    `${API_BASE_URL}/api/interview/competence-papers/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function deleteCompetencePaper(
  paperId: number,
  token?: string
): Promise<void> {
  const accessToken = getAccessTokenFromCookie() || token;
  await handleAuthenticatedResponse<void>(
    `${API_BASE_URL}/api/interview/competence-paper/${paperId}/delete/`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
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
  token?: string
): Promise<AllConversationCompetencePapersResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<AllConversationCompetencePapersResponse>(
    `${API_BASE_URL}/api/interview/conversation-competence-papers/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function getConversationCompetencePaper(
  paperId: number,
  token?: string
): Promise<ConversationCompetencePaper> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConversationCompetencePaper>(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function deleteConversationCompetencePaper(
  paperId: number,
  token?: string
): Promise<void> {
  const accessToken = getAccessTokenFromCookie() || token;
  await handleAuthenticatedResponse<void>(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/delete/`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function exportEditedCV(
  id: number,
  structuredCV: StructuredCV,
  token?: string,
  sectionOrder?: string[],
  type: "cv" | "competence" = "cv"
): Promise<Blob> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedBlobResponse(`${API_BASE_URL}/api/cv/${id}/structured/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structured_cv: structuredCV,
      section_order: sectionOrder,
      type,
    }),
  });
}

// ---------------------------------------------------------------------------
// Conversation sessions (voice-based verification flow)
// ---------------------------------------------------------------------------

export interface ConversationSessionStartResponse {
  session_id: number;
  status: "pending" | "in_progress" | "completed" | "canceled";
}

export async function startConversationSession(
  cvId: number,
  paperId: number,
  token?: string
): Promise<ConversationSessionStartResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConversationSessionStartResponse>(
    `${API_BASE_URL}/api/interview/conversation-session/start/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ cv_id: cvId, paper_id: paperId }),
    }
  );
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
  payload: ConversationTurnPayload,
  token?: string
): Promise<ConversationTurnResponse> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConversationTurnResponse>(
    `${API_BASE_URL}/api/interview/conversation-session/turn/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    }
  );
}

export async function generateConversationCompetencePaper(
  sessionId: number,
  token?: string
): Promise<ConversationCompetencePaperWithCV> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConversationCompetencePaperWithCV>(
    `${API_BASE_URL}/api/interview/conversation-session/${sessionId}/generate-paper/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

export async function updateConversationCompetencePaper(
  paperId: number,
  content: string,
  token?: string
): Promise<ConversationCompetencePaperWithCV> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<ConversationCompetencePaperWithCV>(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/edit/`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ content }),
    }
  );
}

export async function downloadConversationCompetencePaperPdf(
  paperId: number,
  token?: string
): Promise<Blob> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedBlobResponse(
    `${API_BASE_URL}/api/interview/conversation-competence-paper/${paperId}/pdf/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Text-to-Speech (OpenAI Emotional TTS)
// ---------------------------------------------------------------------------

export async function playTextToSpeech(
  text: string,
  signal?: AbortSignal,
  token?: string
): Promise<HTMLAudioElement> {
  const accessToken = getAccessTokenFromCookie() || token;
  const res = await fetchWithAuthRetry(`${API_BASE_URL}/api/llm/tts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ text }),
    signal,
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

export async function endConversationSession(
  sessionId: number,
  token?: string
): Promise<{ detail: string; status: string }> {
  const accessToken = getAccessTokenFromCookie() || token;
  return handleAuthenticatedResponse<{ detail: string; status: string }>(
    `${API_BASE_URL}/api/interview/conversation-session/${sessionId}/end/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
}

