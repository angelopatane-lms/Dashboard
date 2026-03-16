import type * as React from "react";

export default function SectionTitle({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`mb-4 text-lg font-semibold tracking-tight text-gray-900 sm:text-xl ${
        className ?? ""
      }`.trim()}
    >
      {children}
    </h2>
  );
}

export function Section({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`mt-10 ${className ?? ""}`.trim()}>{children}</section>;
}
