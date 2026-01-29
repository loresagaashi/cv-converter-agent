export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="max-w-2xl text-center space-y-6">
        <div className="space-y-3">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-50 leading-tight">
            Transform Your CV into
            <span className="block text-emerald-400 mt-1">Professional Formats</span>
          </h1>
          <p className="text-slate-300 text-base md:text-lg leading-relaxed max-w-xl mx-auto">
            Upload your CV, extract structured data, and generate beautifully formatted PDFs. 
            Get AI-powered competence summaries in seconds.
          </p>
        </div>
        <div className="flex items-center justify-center pt-4">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400 transition-all hover:shadow-xl hover:shadow-emerald-500/50"
          >
            Sign in
          </a>
        </div>
        <div className="pt-6 text-xs text-slate-500">
          Free to use • Secure • No credit card required
        </div>
      </div>
    </div>
  );
}
