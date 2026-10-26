import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { ReviewConfig } from "../config.js";
export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL 格式无效");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("只允许 http/https URL");
  if (u.username || u.password) throw new Error("URL 不允许包含用户名或密码");
  if (u.href.length > 4096) throw new Error("URL 过长");
  return u;
}
function hostname(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}
export function addressRange(address: string): string {
  try {
    return ipaddr.process(address).range();
  } catch {
    return "invalid";
  }
}
function literalLoopback(host: string): boolean {
  return host === "localhost" || (isIP(host) !== 0 && addressRange(host) === "loopback");
}
export class NetworkPolicy {
  private readonly allowed: Set<string>;
  constructor(
    private readonly config: Pick<ReviewConfig, "url" | "allowOrigins" | "allowPrivateNetwork">,
    private readonly resolver: Resolver = (h) => lookup(h, { all: true, verbatim: true }),
  ) {
    const target = parseHttpUrl(config.url);
    this.allowed = new Set(
      config.allowOrigins.map((raw) => {
        const u = parseHttpUrl(raw);
        if (u.pathname !== "/" || u.search || u.hash)
          throw new Error("allowOrigins 只能包含精确 origin（协议、主机、端口），不能包含路径或通配符");
        return u.origin;
      }),
    );
    if (literalLoopback(hostname(target))) this.allowed.add(target.origin);
    if (!this.allowed.has(target.origin)) throw new Error("非本机目标必须显式加入 allowOrigins");
  }
  async authorize(raw: string): Promise<{ url: URL; address: string; family: number }> {
    const url = parseHttpUrl(raw);
    const host = hostname(url);
    if (!this.allowed.has(url.origin)) throw new Error("目标 origin 未授权");
    if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal"))
      throw new Error("禁止元数据服务");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resolved = await Promise.race([
      isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : this.resolver(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS 解析超时")), 5000);
        timer.unref();
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (!resolved.length) throw new Error("DNS 未返回地址");
    for (const item of resolved) {
      const range = addressRange(item.address);
      if (range === "loopback") {
        if (!literalLoopback(host)) throw new Error("拒绝域名解析到回环地址");
      } else if (range === "private" || range === "uniqueLocal") {
        if (!this.config.allowPrivateNetwork)
          throw new Error("私网地址需要 allowPrivateNetwork 与精确 allowOrigins");
      } else if (range !== "unicast") throw new Error("禁止元数据、链路本地、保留或特殊用途地址");
      if (host === "localhost" && range !== "loopback") throw new Error("localhost 未解析到回环地址");
    }
    const first = resolved[0];
    if (!first) throw new Error("DNS 未返回地址");
    return { url, ...first };
  }
}
