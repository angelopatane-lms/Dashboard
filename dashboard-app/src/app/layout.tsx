import "./globals.css";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";

export const metadata = {
  title: "Dashboard",
  description: "Dashboard Operatori & Dispatch"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body className="text-gray-900">
        {/* L'accesso con password è gestito da src/middleware.ts */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
