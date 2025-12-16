This is the **CV Converter** frontend, built with [Next.js](https://nextjs.org) App Router, TypeScript, and Tailwind CSS.

It talks to the existing Django REST backend under `/api/**`.

## Getting Started

### 1. Install dependencies

From the `frontend` directory:

```bash
npm install
```

### 2. Configure backend API URL

Create a `.env.local` file in `frontend` with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Adjust the URL if your Django server runs elsewhere.

### 3. Run the development server

Make sure your Django backend is running, then start Next.js:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Main Routes

- `/` – marketing/landing entry for the CV Converter.
- `/login` – email/password login against `/api/users/login/`.
- `/signup` – user registration against `/api/users/signup/`.
- `/dashboard` – authenticated CV dashboard (upload + list).
- `/cv/[id]` – authenticated CV detail with extracted text and competence summary.

## Auth & API Integration

- Auth tokens are issued by the Django backend (`rest_framework.authtoken`) and stored in memory, with optional “remember me” in `localStorage`.
- The frontend uses a central API client (`lib/api.ts`) and an `AuthProvider` context to attach `Authorization: Token <token>` headers for protected endpoints.

## Linting

From the `frontend` directory you can run:

```bash
npm run lint
```
