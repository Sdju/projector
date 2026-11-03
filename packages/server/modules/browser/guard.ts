import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

/** Адреса машины и локальной сети: прокси их не открывает, чтобы страница из интернета не ходила во внутренние сервисы. */
const internal = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  internal.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  internal.addSubnet(net, prefix, "ipv6");

export function isInternalAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const value = mapped?.[1] ?? address;
  const family = isIP(value);
  return !family || internal.check(value, family === 6 ? "ipv6" : "ipv4");
}

/** Для адреса-литерала Node не вызывает `lookup`, поэтому он проверяется отдельно. */
export function isInternalLiteral(hostname: string): boolean {
  const literal = hostname.replace(/^\[|\]$/g, "");
  return !!isIP(literal) && isInternalAddress(literal);
}

export const INTERNAL_MESSAGE = "Прокси не открывает адреса локальной сети";

/**
 * DNS-разрешение с проверкой: сокет подключается к тому же адресу, который проверен,
 * поэтому DNS rebinding не обходит запрет.
 */
export const guardedLookup: typeof lookup = ((
  hostname: string,
  options: unknown,
  callback: unknown,
) => {
  const done = (typeof options === "function" ? options : callback) as (
    error: Error | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const all = typeof options === "object" && !!options && (options as { all?: boolean }).all;
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return done(error);
    const allowed = addresses.filter((item) => !isInternalAddress(item.address));
    if (!allowed.length) return done(new Error(INTERNAL_MESSAGE));
    if (all) return done(null, allowed);
    done(null, allowed[0]!.address, allowed[0]!.family);
  });
}) as typeof lookup;
