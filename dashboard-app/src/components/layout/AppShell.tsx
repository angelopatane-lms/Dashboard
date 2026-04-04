"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppSidebar from "@/components/layout/AppSidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full">
        <div className="hidden lg:block">
          <AppSidebar mode="desktop" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button
              type="button"
              aria-label="Apri menu"
              className="rounded-md px-2 py-1 text-slate-900 ring-1 ring-slate-300"
              onClick={() => setOpen(true)}
            >
              ☰
            </button>
            <div className="text-sm font-semibold text-slate-900">Dashboard</div>
          </div>

          <main className="min-w-0 flex-1">{children}</main>
        </div>

        {open ? (
          <div className="lg:hidden">
            <button
              type="button"
              aria-label="Chiudi menu"
              className="fixed inset-0 z-40 bg-black/50"
              onClick={() => setOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-[260px]">
              <AppSidebar mode="drawer" onNavigate={() => setOpen(false)} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
