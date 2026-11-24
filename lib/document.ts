import type { Segment, Validation } from "./types";
export type Extracted = {
  segments: Segment[];
  pages: number | null;
  editable: boolean;
  notice?: string;
  previewRegions?: { id: number; page: number; bbox: number[] }[];
};
export type Generated = {
  document: string;
  pdf: string;
  originalPdf: string;
  validation: Validation;
};
export async function documentCall<T>(
  env: Record<string, unknown>,
  path: string,
  data: unknown,
): Promise<T> {
  const url = env.DOCUMENT_SERVICE_URL as string | undefined;
  const token = env.DOCUMENT_SERVICE_TOKEN as string | undefined;
  if (!url || !token)
    throw new Error(
      "The document engine is not connected. Configure DOCUMENT_SERVICE_URL and DOCUMENT_SERVICE_TOKEN on the server. Your original file is saved.",
    );
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(endpoint.hostname)
  )
    throw new Error("The document engine requires HTTPS.");
  let res: Response;
  try {
    res = await fetch(new URL(path, url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error(
      "The document engine is unavailable or timed out. Your saved file can be retried.",
    );
  }
  if (!res.ok) {
    let msg = "Document processing failed.";
    try {
      const d = (await res.json()) as { error?: string };
      msg = d.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
export function base64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function unbase64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
