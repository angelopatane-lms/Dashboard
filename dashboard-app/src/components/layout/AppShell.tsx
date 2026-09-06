"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppSidebar from "@/components/layout/AppSidebar";

const CHIAVE_MENU = "menu-aperto";

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Su desktop la barra si puo' chiudere per lasciare spazio alle tabelle.
  //
  // Parte APERTA sia sul server sia al primo disegno del client, e la
  // preferenza salvata si applica subito dopo: leggerla dentro useState darebbe
  // due HTML diversi fra server e client, e React se ne lamenterebbe.
  const [aperto, setAperto] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHIAVE_MENU) === "0") setAperto(false);
    } catch {
      // Modalita' in incognito o cookie bloccati: si resta con la barra aperta.
    }
  }, []);

  const cambiaBarra = () => {
    setAperto((prima) => {
      const dopo = !prima;
      try {
        window.localStorage.setItem(CHIAVE_MENU, dopo ? "1" : "0");
      } catch {
        // La preferenza non si salva, ma la barra si apre e si chiude lo stesso.
      }
      return dopo;
    });
  };

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full">
        <div className="hidden lg:block">
          <AppSidebar mode="desktop" aperto={aperto} onToggle={cambiaBarra} />
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
