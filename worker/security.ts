export const MAX_BODY_BYTES = 4096;
export const SESSION_MAX_AGE_S = 365 * 24 * 3600;

export class RequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Stop reading at the limit, including requests without Content-Length. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("Content-Length")) > MAX_BODY_BYTES) {
    await req.body?.cancel();
    throw new RequestError(413, "Request body is too large");
  }
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) return {};
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // Report malformed JSON without returning parser details or request content.
  }
  throw new RequestError(400, "Expected a JSON object");
}
