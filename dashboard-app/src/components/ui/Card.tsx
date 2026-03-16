import type * as React from "react";

export default function Card({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${
        className ?? ""
      }`.trim()}
    >
      {children}
    </div>
  );
}
