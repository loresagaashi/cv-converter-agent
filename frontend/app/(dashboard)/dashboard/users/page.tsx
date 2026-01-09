"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = useMemo(() => user?.role === "admin", [user]);

  useEffect(() => {
    if (!user || !token) return;
    if (!isAdmin) {
      // Non-admins are redirected away from this page.
      router.replace("/dashboard");
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listUsers(token);
        if (!cancelled) {
          setUsers(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Unable to load users.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user, token, isAdmin, router]);

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

  const openCreateForm = () => {
    setFormMode("create");
    setFormState(emptyForm);
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
    if (!token) return;

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
        const created = await createUser(token, payload);
        setUsers((prev) => [...prev, created]);
      } else if (formMode === "edit" && formState.id) {
        const payload: AdminUserUpdatePayload = {
          first_name: formState.first_name || undefined,
          last_name: formState.last_name || undefined,
          role: formState.role,
        };
        if (formState.password) {
          payload.password = formState.password;
        }
        const updated = await updateUser(token, formState.id, payload);
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? updated : u))
        );
      }
      setFormOpen(false);
      setFormState(emptyForm);
    } catch (err: any) {
      setError(err?.message || "Unable to save user.");
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteModal = (u: User) => {
    setDeleteTarget(u);
  };

  const handleConfirmDelete = async () => {
    if (!token || !deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteUser(token, deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-50">
            User Management
          </h1>
          <p className="text-xs md:text-sm text-slate-400">
            Manage application users and their roles.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or role"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500 text-xs">
              ⌕
            </span>
          </div>
          <button
            onClick={openCreateForm}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-2 text-xs md:text-sm font-medium text-slate-950 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400"
          >
            Add User
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading users...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
          {users.length === 0
            ? 'No users found. Use "Add User" to create one.'
            : "No users match your search."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 shadow-lg shadow-black/20">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-slate-800/80 hover:bg-slate-900/60"
                >
                  <td className="px-4 py-2 text-slate-100">
                    {u.first_name || u.last_name
                      ? `${u.first_name} ${u.last_name}`.trim()
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-300">{u.email}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-700/40 text-slate-200 border border-slate-600/40"
                      }`}
                    >
                      {u.role === "admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button
                      onClick={() => openEditForm(u)}
                      className="inline-flex items-center rounded-md border border-slate-600 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openDeleteModal(u)}
                      className="inline-flex items-center rounded-md border border-red-500/60 px-2 py-1 text-xs font-medium text-red-100 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl shadow-black/60">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  {formMode === "create" ? "Add User" : "Edit User"}
                </h2>
                <p className="text-xs text-slate-400">
                  {formMode === "create"
                    ? "Create a new user and assign a role."
                    : "Update user details and role."}
                </p>
              </div>
              <button
                onClick={() => setFormOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-slate-200">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  disabled={formMode === "edit"}
                  onChange={(e) =>
                    handleFormChange("email", e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-60"
                  placeholder="user@example.com"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-slate-200">
                    First name
                  </label>
                  <input
                    type="text"
                    value={formState.first_name}
                    onChange={(e) =>
                      handleFormChange("first_name", e.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="First name"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-slate-200">
                    Last name
                  </label>
                  <input
                    type="text"
                    value={formState.last_name}
                    onChange={(e) =>
                      handleFormChange("last_name", e.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-slate-200">
                    Role
                  </label>
                  <select
                    value={formState.role}
                    onChange={(e) =>
                      handleFormChange("role", e.target.value as UserRole)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-slate-200">
                    {formMode === "create"
                      ? "Password"
                      : "Password (leave blank to keep current)"}
                  </label>
                  <input
                    type="password"
                    value={formState.password}
                    onChange={(e) =>
                      handleFormChange("password", e.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder={
                      formMode === "create"
                        ? "Set an initial password"
                        : "Optional new password"
                    }
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900/70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400 disabled:opacity-60"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl shadow-black/60">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Delete user
                </h2>
                <p className="text-xs text-slate-400">
                  This action cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
              <div className="font-semibold text-slate-100">
                {deleteTarget.first_name || deleteTarget.last_name
                  ? `${deleteTarget.first_name || ""} ${deleteTarget.last_name || ""}`.trim()
                  : "(No name)"}
              </div>
              <div className="text-slate-400">{deleteTarget.email}</div>
              <div className="mt-1 inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-100">
                {deleteTarget.role === "admin" ? "Admin" : "User"}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900/70"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-red-500/30 hover:bg-red-500 disabled:opacity-60"
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


