import { isIP } from 'node:net';

/**
 * `TRUST_PROXY`: which reverse proxies Fastify believes when it resolves the client address from
 * `X-Forwarded-For` (`request.ip`). Per-IP throttling, security events and audit rows use that
 * address, so trusting the header from anyone lets a client spoof it and dodge the per-IP limit.
 *
 *   false (default)      ignore X-Forwarded-For; the TCP peer is the client. Right when the API is
 *                        reached directly (local development, a published container port).
 *   <n>                  trust n proxy hops counted from the TCP peer (1 = one load balancer). The peer
 *                        itself is not checked, so use it only when the API is reachable ONLY through
 *                        those proxies (a private network / security group); otherwise a direct client
 *                        can still spoof the header. Prefer the IP/CIDR list when you know the proxies.
 *   <ip|cidr>[,<ip|cidr>...]   trust these proxies only (e.g. `10.0.0.0/8,172.16.0.0/12`).
 *   true                 trust every hop: only for tests, or when the network guarantees that nothing
 *                        but the proxy can reach the API (the header is then fully attacker-controlled
 *                        for anyone who can).
 */
export type TrustProxy = boolean | number | string[];

const MAX_HOPS = 32;

function isCidrOrIp(entry: string): boolean {
  const [addr, bits, extra] = entry.split('/');
  if (extra !== undefined || addr === undefined) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

/** Parses the env value; throws a readable error for anything it cannot interpret. */
export function parseTrustProxy(value: string | undefined): TrustProxy {
  const text = (value ?? '').trim();
  if (text === '' || text.toLowerCase() === 'false') return false;
  if (text.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops < 1 || hops > MAX_HOPS) {
      throw new Error(`TRUST_PROXY hop count must be 1..${MAX_HOPS} (use "false" to trust nobody)`);
    }
    return hops;
  }
  const entries = text.split(',').map((e) => e.trim());
  const bad = entries.filter((e) => !isCidrOrIp(e));
  if (bad.length > 0) {
    throw new Error(
      `TRUST_PROXY must be "false", "true", a hop count, or a comma-separated list of IPs/CIDRs (invalid: ${bad.join(', ') || '(empty)'})`,
    );
  }
  return entries;
}

/**
 * The value for Fastify's `trustProxy` option. Fastify (>= 5.x) treats a bare number as "trust
 * nobody" (it fails closed), so a hop count is expressed as the function form it does support.
 */
export function toFastifyTrustProxy(
  value: TrustProxy,
): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === 'number' ? (_address, hop) => hop < value : value;
}
