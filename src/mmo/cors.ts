import type http from "node:http";

/** Dev/local: allow any origin. Production: DF_CORS_ORIGINS comma list. */
export function parseCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] | "*" {
  if (env.NODE_ENV !== "production") return "*";
  const raw = (env.DF_CORS_ORIGINS ?? env.VELIS_CORS_ORIGINS)?.trim();
  if (!raw) return "*";
  const list = raw.split(",").map(o => o.trim()).filter(Boolean);
  return list.length > 0 ? list : "*";
}

export function resolveCorsOrigin(
  req: http.IncomingMessage,
  allowed: string[] | "*" = parseCorsOrigins(),
): string {
  if (allowed === "*") return "*";
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowed.includes(origin)) return origin;
  return allowed[0] ?? "*";
}

export function corsHeaders(
  req: http.IncomingMessage,
  allowed: string[] | "*" = parseCorsOrigins(),
): Record<string, string> {
  return { "Access-Control-Allow-Origin": resolveCorsOrigin(req, allowed) };
}
