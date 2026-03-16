import type * as React from "react";

interface KPICardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

export default function KPICard({ label, value, icon }: KPICardProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {icon && (
        <div className="rounded-md bg-slate-100 p-3 text-blue-600">
          {icon}
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-gray-500 sm:text-sm">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
          {value}
        </p>
      </div>
    </div>
  );
}
