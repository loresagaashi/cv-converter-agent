"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthContext";
import {
  AdminUserPayload,
  AdminUserUpdatePayload,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  UserRole,
} from "@/lib/api";
import type { User } from "@/lib/types";
import { Pagination } from "@/components/pagination/Pagination";
import {
  clearCachedUsers,
  getCachedUsers,
  setCachedUsers,
} from "@/lib/dashboardListCache";

type FormMode = "create" | "edit";

interface UserFormState {
  id?: number;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  role: UserRole;
}

const emptyForm: UserFormState = {
  email: "",
  first_name: "",
  last_name: "",
  password: "",
  role: "user",
};

export default function UsersAdminPage() {
  const { user, token } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [formState, setFormState] = useState<UserFormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);

  const pageSize = 50;

  const isAdmin = useMemo(() => user?.role === "admin", [user]);

  const loadUsers = useCallback(
    async (showReloadState = false) => {
      if (!token || !isAdmin) return;

      if (!showReloadState) {
        const cached = getCachedUsers(currentPage, pageSize);
        if (cached) {
          setUsers(cached.items);
          setTotalPages(cached.totalPages);
          setTotalRecords(cached.totalRecords);
          setError(null);
          setLoading(false);
          return;
        }
      }

      setError(null);
      if (showReloadState) {
        setReloading(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await listUsers(token, currentPage, pageSize);

        if (response.totalPages > 0 && currentPage > response.totalPages) {
          setCurrentPage(response.totalPages);
          return;
        }

        setUsers(response.data);
        setTotalPages(response.totalPages);
        setTotalRecords(response.totalRecords);
        setCachedUsers(currentPage, pageSize, {
          items: response.data,
          totalPages: response.totalPages,
          totalRecords: response.totalRecords,
        });
      } catch (err: any) {
        setError(err?.message || "Unable to load users.");
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [currentPage, isAdmin, pageSize, token]
  );

  useEffect(() => {
    if (!user || !token) return;
    if (!isAdmin) {
      // Non-admins are redirected away from this page.
      router.replace("/dashboard");
      return;
    }

    void loadUsers(false);
  }, [user, token, isAdmin, router, loadUsers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  if (!user || !token) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-50">
          User Management
        </h1>
        <p className="text-sm text-slate-400">
          You do not have permission to access this page.
        </p>
      </div>
    );
  }

  const handleReloadUsers = async () => {
    await loadUsers(true);
  };

  const openCreateForm = () => {
    setFormMode("create");
    setFormState(emptyForm);
    setShowPassword(false);
    setFormOpen(true);
  };

  const openEditForm = (u: User) => {
    setFormMode("edit");
    setFormState({
      id: u.id,
      email: u.email,
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      password: "",
      role: u.role,
    });
    setShowPassword(false);
    setFormOpen(true);
  };

  const handleFormChange = (field: keyof UserFormState, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSubmitting(true);
    setError(null);

    try {
      if (formMode === "create") {
        const payload: AdminUserPayload = {
          email: formState.email,
          first_name: formState.first_name || undefined,
          last_name: formState.last_name || undefined,
          password: formState.password || undefined,
          role: formState.role,
        };
        clearCachedUsers();
        await createUser(payload);
        await loadUsers(true);
      } else if (formMode === "edit" && formState.id) {
        const payload: AdminUserUpdatePayload = {
          first_name: formState.first_name || undefined,
          last_name: formState.last_name || undefined,
          role: formState.role,
        };
        if (formState.password) {
          payload.password = formState.password;
        }
        clearCachedUsers();
        const updated = await updateUser(formState.id, payload);
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      }
      setFormOpen(false);
      setFormState(emptyForm);
      setShowPassword(false);
    } catch (err: any) {
      setError(err?.message || "Unable to save user.");
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteModal = (u: User) => {
    // Prevent admins from deleting their own account
    if (user?.id === u.id) {
      setError("You cannot delete your own account.");
      return;
    }
    setDeleteTarget(u);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    // Safety check: prevent admins from deleting their own account
    if (user?.id === deleteTarget.id) {
      setError("You cannot delete your own account.");
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      clearCachedUsers();
      await deleteUser(deleteTarget.id);
      await loadUsers(true);
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || "Unable to delete user.");
    } finally {
      setDeleting(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => {
      const name = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      return (
        u.email.toLowerCase().includes(term) ||
        name.includes(term) ||
        u.role.toLowerCase().includes(term)
      );
    });
  }, [search, users]);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 mb-1.5 tracking-tight">
              User Management
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Manage users, roles, and permissions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:flex-initial sm:w-64">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:block">
              {filteredUsers.length} on page • {totalRecords} total
            </span>
            <button
              type="button"
              onClick={() => void handleReloadUsers()}
              disabled={loading || reloading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800/80 hover:border-slate-600/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              title="Reload user records"
            >
              <svg className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
              </svg>
            </button>
            <button
              onClick={openCreateForm}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 transition-all duration-200"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 text-sm text-red-200">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-16 rounded-lg bg-white/10 animate-pulse"
              />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-6 py-12 text-center">
            <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <p className="text-base font-semibold text-slate-300 mb-1">
              {totalRecords === 0 ? "No users yet" : "No results found on this page"}
            </p>
            <p className="text-sm text-slate-500 mb-4">
              {totalRecords === 0
                ? 'Click "Add User" to create your first user'
                : "Try adjusting your search terms"}
            </p>
            {totalRecords === 0 && (
              <button
                onClick={openCreateForm}
                className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all"
              >
                Add User
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <div
              className={`space-y-2 min-w-max ${
                filteredUsers.length > 10 ? "max-h-168 overflow-y-auto pr-1" : ""
              }`}
            >
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                className="flex min-w-[760px] items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-3.5 hover:bg-slate-900/50 hover:border-slate-700/80 transition-all duration-200"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold text-slate-100">
                      {u.first_name || u.last_name
                        ? `${u.first_name} ${u.last_name}`.trim()
                        : "—"}
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        u.role === "admin"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-700/50 text-slate-200 border border-slate-600/50"
                      }`}
                    >
                      {u.role === "admin" ? "Admin" : "User"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {u.email}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEditForm(u)}
                    className="inline-flex items-center rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800/60 hover:border-slate-600/80 transition-all duration-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => openDeleteModal(u)}
                    disabled={user?.id === u.id}
                    className="inline-flex items-center rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-200 hover:bg-red-500/20 hover:border-red-500/60 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10 disabled:hover:border-red-500/40"
                    title={user?.id === u.id ? "You cannot delete your own account" : "Delete user"}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        hasNext={currentPage < totalPages}
        hasPrevious={currentPage > 1}
        onPageChange={setCurrentPage}
        isLoading={loading || reloading}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-h-[90vh] max-w-md overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between">
              <div className="flex-1">
                <h2 className="text-base font-semibold text-slate-50 mb-1">
                  {formMode === "create" ? "Add User" : "Edit User"}
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {formMode === "create"
                    ? "Create a new user and assign a role"
                    : "Update user details and role"}
                </p>
              </div>
              <button
                onClick={() => {
                  setFormOpen(false);
                  setShowPassword(false);
                }}
                className="ml-4 rounded-lg p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-all"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  disabled={formMode === "edit"}
                  onChange={(e) =>
                    handleFormChange("email", e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all disabled:opacity-60"
                  placeholder="user@example.com"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    First name
                  </label>
                  <input
                    type="text"
                    value={formState.first_name}
                    onChange={(e) =>
                      handleFormChange("first_name", e.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    placeholder="John"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Last name
                  </label>
                  <input
                    type="text"
                    value={formState.last_name}
                    onChange={(e) =>
                      handleFormChange("last_name", e.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Role
                  </label>
                  <select
                    value={formState.role}
                    onChange={(e) =>
                      handleFormChange("role", e.target.value as UserRole)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    {formMode === "create"
                      ? "Password"
                      : "Password (optional)"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formState.password}
                      onChange={(e) =>
                        handleFormChange("password", e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-2.5 pr-11 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                      placeholder={
                        formMode === "create"
                          ? "Set a password"
                          : "Leave blank to keep current"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-200"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3l18 18M10.58 10.58A3 3 0 0013.42 13.42M9.88 5.09A10.45 10.45 0 0112 4.91c5 0 9.27 3.11 11 7.5a11.47 11.47 0 01-4.12 5.09M6.61 6.61A11.44 11.44 0 001 12.41a11.45 11.45 0 005.2 5.89A10.39 10.39 0 0012 20.09c1.47 0 2.87-.3 4.13-.84" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.46 12C3.73 7.94 7.52 5 12 5s8.27 2.94 9.54 7c-1.27 4.06-5.06 7-9.54 7s-8.27-2.94-9.54-7z" />
                          <circle cx="12" cy="12" r="3" strokeWidth={1.8} />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    setShowPassword(false);
                  }}
                  className="w-full rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:border-slate-600/80 transition-all duration-200 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 active:bg-emerald-500 disabled:opacity-60 transition-all duration-200 sm:w-auto"
                >
                  {submitting
                    ? formMode === "create"
                      ? "Creating..."
                      : "Saving..."
                    : formMode === "create"
                    ? "Create user"
                    : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-h-[90vh] max-w-sm overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl sm:p-6">
            <h3 className="text-base font-semibold text-slate-50 mb-1">Delete User</h3>
            {user?.id === deleteTarget.id ? (
              <div className="rounded-lg bg-red-500/10 border border-red-500/40 px-4 py-3 mb-4">
                <p className="text-sm text-red-200">
                  You cannot delete your own account. Please ask another admin to perform this action.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400 leading-relaxed mb-4">
                Are you sure you want to delete <span className="font-medium text-slate-300">
                  {deleteTarget.first_name || deleteTarget.last_name
                    ? `${deleteTarget.first_name || ""} ${deleteTarget.last_name || ""}`.trim()
                    : deleteTarget.email}
                </span>? This action cannot be undone.
              </p>
            )}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 mb-4">
              <div className="text-sm font-semibold text-slate-100 mb-1 wrap-break-word">
                {deleteTarget.first_name || deleteTarget.last_name
                  ? `${deleteTarget.first_name || ""} ${deleteTarget.last_name || ""}`.trim()
                  : "(No name)"}
              </div>
              <div className="text-xs text-slate-400 mb-2 break-all">{deleteTarget.email}</div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  deleteTarget.role === "admin"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                    : "bg-slate-700/50 text-slate-200 border border-slate-600/50"
                }`}
              >
                {deleteTarget.role === "admin" ? "Admin" : "User"}
              </span>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/60 hover:border-slate-600/80 transition-all duration-200"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting || user?.id === deleteTarget.id}
                className="rounded-lg bg-red-500 px-5 py-2 text-sm font-bold text-white hover:bg-red-600 active:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-red-500/30"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


