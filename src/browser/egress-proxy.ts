import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { message, redactUrl } from "../utils/safety.js";
import type { NetworkPolicy } from "./network-policy.js";
export interface BlockedRequest {
  url: string;
  reason: string;
}
export async function startEgressProxy(policy: NetworkPolicy, onBlocked: (event: BlockedRequest) => void) {
  const username = "aestheticflow";
  const password = randomBytes(24).toString("hex");
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
  };
  const blocked = (url: string, error: unknown) => onBlocked({ url: redactUrl(url), reason: message(error) });
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.headers["proxy-authorization"] !== expected) {
        res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="AestheticFlow"' }).end();
        return;
      }
      const raw = req.url ?? "";
      try {
        const { url, address, family } = await policy.authorize(raw);
        const headers = { ...req.headers };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        headers.host = url.host;
        const upstream = (url.protocol === "https:" ? https : http).request(
          {
            protocol: url.protocol,
            hostname: address,
            family,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: req.method,
            headers,
            servername: url.hostname.replace(/^\[|\]$/g, ""),
            agent: false,
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          },
        );
        upstream.on("socket", track);
        upstream.setTimeout(15000, () => upstream.destroy(new Error("上游请求超时")));
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end("Upstream unavailable");
        });
        req.on("aborted", () => upstream.destroy());
        res.on("close", () => upstream.destroy());
        req.pipe(upstream);
      } catch (error) {
        blocked(raw, error);
        if (!res.headersSent) res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Blocked by AestheticFlow network policy");
      }
    })();
  });
  server.on("connection", track);
  server.on("connect", (req, client, head) => {
    void (async () => {
      if (req.headers["proxy-authorization"] !== expected) {
        client.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="AestheticFlow"\r\n\r\n',
        );
        return;
      }
      const raw = `https://${req.url}`;
      try {
        const { url, address, family } = await policy.authorize(raw);
        const remote = net.connect({ host: address, port: Number(url.port || 443), family });
        track(remote);
        remote.setTimeout(20000, () => remote.destroy());
        remote.once("connect", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) remote.write(head);
          remote.pipe(client);
          client.pipe(remote);
        });
        remote.on("error", () => client.destroy());
        client.on("error", () => remote.destroy());
        client.on("close", () => remote.destroy());
        remote.on("close", () => client.destroy());
      } catch (error) {
        blocked(raw, error);
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法启动本地网络代理");
  return {
    server: `http://127.0.0.1:${address.port}`,
    username,
    password,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
