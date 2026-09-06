import type * as React from "react";

/**
 * Il contenuto usa tutta la larghezza disponibile.
 *
 * Prima c'era un tetto di 1280px (max-w-7xl): su un monitor da 1920, con la
 * barra laterale da 260, restavano quasi 400 pixel di sfondo vuoto ai lati
 * mentre la tabella Campagne - diciassette colonne - scorreva orizzontalmente.
 * Il margine laterale resta, ma stretto: serve a staccare le schede dal bordo,
 * non a incorniciarle.
 */
export default function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-gray-900">
      <main className="w-full px-3 py-6 sm:px-4 sm:py-8 lg:px-6">{children}</main>
    </div>
  );
}
