import { readFile } from "node:fs/promises";
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseDocument, isolatedCases } from "./variants.js";

const base = fileURLToPath(new URL("./", import.meta.url));
export async function startFixtureServer(port = 0) {
  let blockedHits = 0;
  const signals: Record<string, number> = {};
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/signals/")) {
      signals[url.pathname] = (signals[url.pathname] ?? 0) + 1;
      res.writeHead(204).end();
      return;
    }
    const isolated = isolatedCases[url.pathname];
    if (isolated) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(caseDocument(isolated));
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/missing.png") {
      res.writeHead(404).end("Image missing by design");
      return;
    }
    if (url.pathname === "/redirect") {
      res
        .writeHead(302, {
          Location: url.searchParams.get("to") ?? "http://169.254.169.254/latest/meta-data/",
        })
        .end();
      return;
    }
    if (url.pathname === "/secret") {
      blockedHits++;
      res.end("should never be reached");
      return;
    }
    if (url.pathname === "/empty") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html lang="en"><title>Empty</title><body></body></html>');
      return;
    }
    if (url.pathname === "/blank-css") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><title>CSS drawing</title><body><div style="width:80px;height:80px;background:red"></div></body></html>',
      );
      return;
    }
    if (url.pathname === "/ok.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#d4e99e"/><circle cx="80" cy="50" r="28" fill="#315044"/></svg>',
      );
      return;
    }
    const name =
      url.pathname === "/good" || url.pathname === "/"
        ? "good.html"
        : url.pathname === "/lazy"
          ? "lazy.html"
          : url.pathname === "/broken"
            ? "broken.html"
            : null;
    if (!name) {
      res.writeHead(404).end("Fixture not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await readFile(resolve(base, name)));
  });
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(port, "127.0.0.1", r);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    signals,
    get blockedHits() {
      return blockedHits;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startFixtureServer(Number(process.env.PORT ?? 4173));
  console.log(`AestheticFlow fixtures: ${server.url}/good and /broken`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
}
