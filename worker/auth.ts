const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function newToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(9)));
}

/** Tokens are only ever stored as SHA-256 hex digests. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const COOKIE = "fa_session";

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization");
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Cookie-authenticated mutations must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true; // non-browser client; cookies are SameSite=Lax anyway
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
