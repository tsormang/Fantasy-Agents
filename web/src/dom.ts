type Child = Node | string | null | undefined | false;

/** Tiny DOM builder. Text is always set via textContent, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  for (const k of kids) if (k) node.append(k);
  return node;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as any).error || `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

export function copyButton(text: () => string): HTMLButtonElement {
  const b = el("button", { class: "quiet", textContent: "Copy" });
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text());
      b.textContent = "Copied";
    } catch {
      b.textContent = "Select + copy";
    }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  };
  return b;
}

export const ago = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
};
