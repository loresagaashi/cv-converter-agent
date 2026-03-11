import React from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

/**
 * Reusable pagination component
 * Shows Previous/Next buttons and page numbers
 */
export function Pagination({
  currentPage,
  totalPages,
  hasNext,
  hasPrevious,
  onPageChange,
  isLoading = false,
}: PaginationProps) {
  const pageNumbers: (number | string)[] = [];

  // Show first page
  pageNumbers.push(1);

  // Show pages around current page
  if (currentPage > 3) {
    pageNumbers.push("...");
  }

  const startPage = Math.max(2, currentPage - 1);
  const endPage = Math.min(totalPages - 1, currentPage + 1);

  for (let i = startPage; i <= endPage; i++) {
    if (!pageNumbers.includes(i)) {
      pageNumbers.push(i);
    }
  }

  // Show last page
  if (totalPages > 1 && !pageNumbers.includes(totalPages)) {
    if (pageNumbers[pageNumbers.length - 1] !== "...") {
      pageNumbers.push("...");
    }
    pageNumbers.push(totalPages);
  }

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-800/60 bg-slate-950/30 px-2.5 py-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      <div className="flex flex-col items-stretch gap-2 sm:hidden">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!hasPrevious || isLoading}
            className="min-h-9 rounded-lg border border-slate-600 px-2.5 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={!hasNext || isLoading}
            className="min-h-9 rounded-lg border border-slate-600 px-2.5 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:order-3"
          >
            Next
          </button>
        </div>

        <div className="flex items-center justify-center gap-1 overflow-x-auto pb-0.5">
          {pageNumbers.map((page, idx) => (
            <React.Fragment key={idx}>
              {page === "..." ? (
                <span className="px-1.5 py-1.5 text-sm text-slate-400">...</span>
              ) : (
                <button
                  onClick={() => onPageChange(page as number)}
                  disabled={isLoading}
                  className={`min-h-9 min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    page === currentPage
                      ? "bg-emerald-500 text-slate-950"
                      : "border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  {page}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="text-center text-xs text-slate-400">
          Page {currentPage} of {totalPages}
        </div>
      </div>

      <div className="hidden sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrevious || isLoading}
          className="min-h-9 rounded-lg border border-slate-600 px-2.5 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors justify-self-start"
        >
          Previous
        </button>

        <div className="flex min-w-0 items-center justify-center gap-3">
          <div className="text-center text-sm text-slate-400">
            Page {currentPage} of {totalPages}
          </div>

          <div className="flex items-center justify-center gap-1 overflow-x-auto">
            {pageNumbers.map((page, idx) => (
              <React.Fragment key={idx}>
                {page === "..." ? (
                  <span className="px-1.5 py-1.5 text-sm text-slate-400">...</span>
                ) : (
                  <button
                    onClick={() => onPageChange(page as number)}
                    disabled={isLoading}
                    className={`min-h-9 min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      page === currentPage
                        ? "bg-emerald-500 text-slate-950"
                        : "border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    }`}
                  >
                    {page}
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNext || isLoading}
          className="min-h-9 rounded-lg border border-slate-600 px-2.5 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors justify-self-end"
        >
          Next
        </button>
      </div>
    </div>
  );
}
