import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { corsHeaders } from "../src/mmo/cors.js";

/** Acepta seed numérica o texto (ej. "clanrodriguez") → entero determinista. */
export function parseSeed(raw: string | undefined | null): number {
  if (raw == null || raw === "") return 42;
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (!Number.isNaN(n) && String(n) === trimmed) return n;
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++)
    hash = ((hash << 5) - hash + trimmed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export class SeedNotAvailable extends Error {}

export function sendBin(res: http.ServerResponse, gzData: Buffer, acceptGzip: boolean, req?: http.IncomingMessage): void {
  const cors = req ? corsHeaders(req) : { "Access-Control-Allow-Origin": "*" };
  if (acceptGzip) {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "gzip",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...cors,
    });
    res.end(gzData);
  } else {
    zlib.gunzip(gzData, (err, raw) => {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...cors,
      });
      res.end(raw);
    });
  }
}

export function sendJson(req: http.IncomingMessage, res: http.ServerResponse, data: unknown): void {
  const json = JSON.stringify(data);
  const cors = corsHeaders(req);
  const gz = (req.headers["accept-encoding"] ?? "").includes("gzip");
  if (gz) {
    zlib.gzip(json, (err, buf) => {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        ...cors,
      });
      res.end(buf);
    });
  } else {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(json);
  }
}

export function parseQ(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

/** 404 for not-pre-generated seeds (serve-only), 500 otherwise. */
export function sendErr(res: http.ServerResponse, e: unknown, req?: http.IncomingMessage): void {
  const cors = req ? corsHeaders(req) : { "Access-Control-Allow-Origin": "*" };
  if (e instanceof SeedNotAvailable) {
    res.writeHead(404, {
      "Content-Type": "application/json",
      ...cors,
    });
    res.end(JSON.stringify({ error: e.message, code: "SEED_NOT_AVAILABLE" }));
  } else {
    res.writeHead(500);
    res.end(String(e));
  }
}

/** Serve viewer static assets (HTML, JS). Returns true if handled. */
export function serveViewerStatic(
  pathname: string,
  res: http.ServerResponse,
  root: string,
): boolean {
  if (pathname === "/branding.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "branding.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/terrain-tactics.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "terrain-tactics.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/tactical-orders.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "tactical-orders.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/hud.css") {
    try {
      const css = fs.readFileSync(path.join(root, "viewer", "hud.css"), "utf8");
      res.writeHead(200, { "Content-Type": "text/css", "Cache-Control": "no-cache" });
      res.end(css);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/config.js" || pathname === "/capacitor-init.js") {
    const file = pathname.slice(1);
    try {
      const js = fs.readFileSync(path.join(root, "viewer", file), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/vendor/phaser.min.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "vendor", "phaser.min.js"));
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/path-worker.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "path-worker.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/tile-sw.js") {
    try {
      const js = fs.readFileSync(path.join(root, "viewer", "tile-sw.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  if (pathname === "/" || pathname === "/index.html") {
    try {
      const html = fs.readFileSync(path.join(root, "viewer", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  return false;
}
