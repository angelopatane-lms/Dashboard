import type * as React from "react";

export default function ChartTitle({
  title,
  description,
  className
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative inline-flex max-w-full items-center ${className ?? ""}`.trim()}>
      <div className="group inline-flex max-w-full cursor-help items-center">
        <div className="truncate text-sm font-semibold text-gray-900">{title}</div>
        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-[320px] rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg group-hover:block">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="mt-1 leading-relaxed text-slate-600">{description}</div>
        </div>
      </div>
    </div>
  );
}
