"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api, type Company, type Me } from "./api";

type AuthState = {
  loading: boolean;
  me: Me | null;
  companies: Company[];
  activeCompanyId: string | null;
  refresh: () => Promise<void>;
  setActiveCompany: (id: string) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

const ACTIVE_KEY = "tm.activeCompanyId";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyId, setActiveCompanyState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const m = await api.me();
      setMe(m);
      const list = await api.listCompanies();
      setCompanies(list.companies);

      // Pick active: localStorage > server-provided active > first in list.
      const stored =
        typeof window !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
      const candidate =
        (stored && list.companies.find((c) => c.id === stored)?.id) ||
        m.active_company_id ||
        list.companies[0]?.id ||
        null;
      setActiveCompanyState(candidate);
    } catch {
      setMe(null);
      setCompanies([]);
      setActiveCompanyState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const setActiveCompany = useCallback((id: string) => {
    setActiveCompanyState(id);
    if (typeof window !== "undefined") localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      if (typeof window !== "undefined") localStorage.removeItem(ACTIVE_KEY);
      setMe(null);
      setCompanies([]);
      setActiveCompanyState(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Ctx.Provider
      value={{ loading, me, companies, activeCompanyId, refresh, setActiveCompany, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
