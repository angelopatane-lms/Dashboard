"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Le icone sono disegnate qui invece di arrivare da una libreria: sono quattro,
// e una dipendenza in piu' per quattro tracciati non si giustifica.
const ICONE: Record<string, ReactNode> = {
  "/advisor": (
    <path d="M4 20a8 8 0 0 1 16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
  ),
  "/setter": (
    <path d="M4 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 4 5Z" />
  ),
  "/contatti": (
    <path d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0c-2.7 0-5 1.6-5 3.5V19h10v-3.5C13 13.6 10.7 12 8 12Zm8-6h5M16 10h5M16 14h5" />
  ),
  "/campagne": (
    <path d="M4 20V10m5 10V5m5 15v-7m5 7V8" />
  )
};

// L'ordine di questo elenco e' l'unico che conta: decide sia la barra laterale
// sia, di riflesso, il percorso che si segue passando da una pagina all'altra.
// Contatti sta in fondo perche' e' la pagina di consultazione del singolo
// contatto, mentre le prime tre sono le viste di lavoro quotidiane.
const PAGES: Array<{ label: string; href: string }> = [
  { label: "Advisor", href: "/advisor" },
  { label: "Setter", href: "/setter" },
  { label: "Campagne", href: "/campagne" },
  { label: "Contatti", href: "/contatti" }
];

const CONTACTS_SECTIONS: Array<{ label: string; id: string }> = [
  { label: "Timeline Eventi", id: "timeline-eventi" }
];

const CAMPAIGNS_SECTIONS: Array<{ label: string; id: string }> = [
  { label: "Filtri", id: "filtri" },
  { label: "Campagne", id: "campagne" },
  { label: "Insights", id: "insights" }
];

const ADVISOR_SECTIONS: Array<{ label: string; id: string }> = [
  { label: "Filtri", id: "filtri" },
  { label: "KPI Advisor", id: "tabella-operatori" },
  { label: "Trend Principali", id: "trend-funnel" },
  { label: "Stati Lead", id: "stati-lead" },
  { label: "Performance", id: "performance" }
];

const SETTER_SECTIONS: Array<{ label: string; id: string }> = [
  { label: "Filtri", id: "filtri" },
  { label: "KPI Setter", id: "tabella-operatori" },
  { label: "Trend Principali", id: "trend-funnel" },
  { label: "Stati Lead", id: "stati-lead" },
  { label: "Performance", id: "performance" }
];

function sectionsForPage(href: string) {
  if (href === "/contatti") return CONTACTS_SECTIONS;
  if (href === "/campagne") return CAMPAIGNS_SECTIONS;
  if (href === "/advisor") return ADVISOR_SECTIONS;
  if (href === "/setter") return SETTER_SECTIONS;
  return [];
}

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  if (pathname.startsWith(href + "/")) return true;
  return false;
}

function Icona({ href }: { href: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      {ICONE[href]}
    </svg>
  );
}

export default function AppSidebar({
  mode = "desktop",
  onNavigate,
  aperto = true,
  onToggle
}: {
  mode?: "desktop" | "drawer";
  onNavigate?: () => void;
  /** Solo su desktop: chiusa mostra le sole icone, aperta icona e titolo. */
  aperto?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname() ?? "/";

  // Il cassetto su mobile e' sempre esteso: li' lo spazio da recuperare non c'e',
  // la barra sta sopra il contenuto e si chiude appena si naviga.
  const esteso = mode === "drawer" || aperto;
  const larghezza = esteso ? "w-[260px]" : "w-16";

  const asideClassName =
    mode === "desktop"
      ? `sticky top-0 flex h-screen ${larghezza} shrink-0 flex-col bg-black text-white transition-[width] duration-200`
      : `flex h-full ${larghezza} shrink-0 flex-col bg-black text-white`;

  return (
    <aside className={asideClassName}>
      <div
        className={`flex items-center gap-2 bg-black py-5 ${esteso ? "px-5" : "px-3 justify-center"} ${
          mode === "desktop" ? "sticky top-0 z-10" : ""
        }`}
      >
        {esteso ? <div className="flex-1 text-lg font-semibold">Dashboard</div> : null}
        {mode === "desktop" && onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={aperto ? "Chiudi menu" : "Apri menu"}
            title={aperto ? "Chiudi menu" : "Apri menu"}
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              {aperto ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
            </svg>
          </button>
        ) : null}
      </div>

      <nav className={`flex flex-1 flex-col gap-1 overflow-y-auto pb-6 ${esteso ? "px-3" : "px-2"}`}>
        {PAGES.map((p) => {
          const active = isActivePath(pathname, p.href);

          return (
            <div key={p.href}>
              <Link
                className={`flex items-center gap-3 rounded-md py-2 text-sm transition ${
                  esteso ? "px-3" : "justify-center px-0"
                } ${active ? "bg-white/10" : "hover:bg-white/10"}`}
                href={p.href}
                onClick={() => onNavigate?.()}
                // Chiusa, il titolo e' l'unico modo per sapere dove si va.
                title={esteso ? undefined : p.label}
              >
                <Icona href={p.href} />
                {esteso ? <span>{p.label}</span> : null}
              </Link>

              {/* Le sezioni interne compaiono solo da aperta: sono ancore a
                  punti della pagina, e senza il testo non direbbero nulla. */}
              {active && esteso ? (
                <div className="mt-1 flex flex-col gap-1 pl-3">
                  {sectionsForPage(p.href).map((s) => (
                    <a
                      key={s.id}
                      className="block rounded-md px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                      href={`#${s.id}`}
                      onClick={() => onNavigate?.()}
                    >
                      {s.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
