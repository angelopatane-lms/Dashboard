"use client";

import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

export function ChartShell({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
      </div>
      <div className="mt-4 h-[340px] w-full">{children}</div>
    </Card>
  );
}
