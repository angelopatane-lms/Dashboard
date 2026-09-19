import PasswordModal from "@/components/auth/PasswordModal";

// Mostrata al posto di qualunque pagina finché non si fa l'accesso (vedi src/middleware.ts).
export default function AccessoPage() {
  return <PasswordModal />;
}
