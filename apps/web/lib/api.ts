// Thin REST client for the FastAPI backend. Cookies (tm_session) carry auth.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Me = {
  account_id: string;
  email: string;
  full_name: string | null;
  jurisdiction: string;
  created_at: string;
  active_company_id: string | null;
};

export type Company = {
  id: string;
  name: string;
  slug: string;
  brand_color: string | null;
  base_currency: string;
  paper_mode: boolean;
  current_asset_tier: number;
  unlocked_contract_types: string[];
  role: "owner" | "admin" | "trader" | "viewer";
  created_at: string;
};

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

export const api = {
  requestMagicLink: (email: string, full_name?: string) =>
    request<{ sent: boolean; dev_link: string | null }>(
      "/api/v1/auth/magic-link",
      { method: "POST", body: JSON.stringify({ email, full_name }) },
    ),

  verifyMagicLink: (token: string) =>
    request<{
      account_id: string;
      email: string;
      full_name: string | null;
      is_new: boolean;
    }>("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),

  me: () => request<Me>("/api/v1/me"),

  listCompanies: () =>
    request<{ companies: Company[] }>("/api/v1/companies"),

  createCompany: (name: string, brand_color?: string) =>
    request<Company>("/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name, brand_color }),
    }),
};
