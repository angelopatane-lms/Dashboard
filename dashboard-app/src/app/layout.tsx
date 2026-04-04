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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
