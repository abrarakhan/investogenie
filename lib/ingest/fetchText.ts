import { get } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export interface TextResponse {
  ok: boolean;
  status: number;
  text: string;
}

function decodeBody(chunks: Buffer[], encoding: string | undefined): string {
  const body = Buffer.concat(chunks);
  if (encoding === "gzip") return gunzipSync(body).toString("utf8");
  if (encoding === "deflate") return inflateSync(body).toString("utf8");
  if (encoding === "br") return brotliDecompressSync(body).toString("utf8");
  return body.toString("utf8");
}

/**
 * BSE's CDN occasionally emits whitespace-prefixed response headers that
 * Undici rejects before exposing the response. Node's native HTTPS client can
 * tolerate that exchange response when insecureHTTPParser is scoped to this
 * request. This is a protocol-compatibility fallback, not a TLS bypass.
 */
export function fetchTextLenient(
  url: string,
  headers: Record<string, string>,
  redirects = 3,
): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    const request = get(url, {
      headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
      insecureHTTPParser: true,
      timeout: 20_000,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (location && status >= 300 && status < 400 && redirects > 0) {
        response.resume();
        fetchTextLenient(new URL(location, url).toString(), headers, redirects - 1).then(resolve, reject);
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        try {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: decodeBody(chunks, response.headers["content-encoding"]),
          });
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error(`Request timed out: ${url}`)));
    request.on("error", reject);
  });
}
