import "./globals.css";
import type { ReactNode } from "react";
import AppSidebar from "@/components/layout/AppSidebar";

export const metadata = {
  title: "Dashboard",
  description: "Dashboard Operatori & Dispatch"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body className="text-gray-900">
        <div className="min-h-screen bg-slate-50">
          <div className="mx-auto flex min-h-screen w-full">
            <AppSidebar />

            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
