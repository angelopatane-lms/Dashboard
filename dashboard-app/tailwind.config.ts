import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Anche src/lib: li' stanno le classi condivise fra piu' tabelle (vedi
    // src/lib/tabelle.ts). Senza questa riga Tailwind non le vede e non genera
    // le regole corrispondenti: le classi finiscono nell'HTML ma non esiste il
    // CSS che le realizza, quindi non fanno niente e non se ne accorge nessuno.
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};

export default config;
