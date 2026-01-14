import { AuthResponse, CV, CVTextResponse, ConvertCVResponse, User, StructuredCV } from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = (data?.detail as string) || JSON.stringify(data);
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

export async function exportEditedCV(
  id: number,
  token: string,
  structuredCV: StructuredCV,
  sectionOrder?: string[]
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


