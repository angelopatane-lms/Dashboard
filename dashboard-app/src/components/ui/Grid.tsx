import type * as React from "react";

export function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {children}
    </div>
  );
}

const mdSpanClass: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
  9: "md:col-span-9",
  10: "md:col-span-10",
  11: "md:col-span-11",
  12: "md:col-span-12"
};

export function Col({
  span,
  children,
  className
}: {
  span: number;
  children: React.ReactNode;
  className?: string;
}) {
  const safe = Math.min(12, Math.max(1, span));
  const mdClass = mdSpanClass[safe] ?? "md:col-span-12";
  return (
    <div className={`col-span-12 ${mdClass} ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
