export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-semibold text-slate-50">
          CV Converter Dashboard
        </h1>
        <p className="text-slate-400 text-sm md:text-base">
          Upload your CVs in PDF or DOCX, extract clean text, and generate
          competence summaries. Sign in to get started.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400 transition-colors"
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-900/60 transition-colors"
          >
            Create account
          </a>
        </div>
      </div>
    </div>
  );
}
