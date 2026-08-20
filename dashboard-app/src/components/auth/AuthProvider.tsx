"use client";

import { useState, useEffect } from "react";
import PasswordModal from "./PasswordModal";

const SESSION_KEY = "dashboard_auth";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === "1") setIsAuthenticated(true);
    setChecked(true);
  }, []);

  const handleSuccess = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setIsAuthenticated(true);
  };

  if (!checked) return null;

  return (
    <>
      {!isAuthenticated && <PasswordModal onSuccess={handleSuccess} />}
      {children}
    </>
  );
}
