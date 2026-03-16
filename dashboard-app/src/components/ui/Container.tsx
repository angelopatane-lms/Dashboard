import type * as React from "react";

export default function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-gray-900">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>
    </div>
  );
}
