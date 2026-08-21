"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES: Array<{ label: string; href: string }> = [
  { label: "Advisor", href: "/advisor" },
  { label: "Setter", href: "/setter" },
  { label: "Contatti", href: "/contatti" },
  { label: "Campagne", href: "/campagne" }
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

export default function AppSidebar({
  mode = "desktop",
  onNavigate
}: {
  mode?: "desktop" | "drawer";
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/";

  const asideClassName =
    mode === "desktop"
      ? "sticky top-0 flex h-screen w-[260px] shrink-0 flex-col bg-black text-white"
      : "flex h-full w-[260px] shrink-0 flex-col bg-black text-white";

  const headerClassName =
    mode === "desktop"
      ? "sticky top-0 z-10 bg-black px-5 py-5 text-lg font-semibold"
      : "bg-black px-5 py-5 text-lg font-semibold";

  return (
    <aside className={asideClassName}>
      <div className={headerClassName}>Dashboard</div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6">
        {PAGES.map((p) => {
          const active = isActivePath(pathname, p.href);

          return (
            <div key={p.href}>
              <Link
                className={`block rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-white/10" : "hover:bg-white/10"
                }`}
                href={p.href}
                onClick={() => onNavigate?.()}
              >
                {p.label}
              </Link>

              {active ? (
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
