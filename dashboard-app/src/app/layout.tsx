import "./globals.css";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import AuthProvider from "@/components/auth/AuthProvider";

export const metadata = {
  title: "Dashboard",
  description: "Dashboard Operatori & Dispatch"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body className="text-gray-900">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
