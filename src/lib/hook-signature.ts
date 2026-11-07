// HMAC-SHA256 over the raw body, compared in constant time. The relay signs
// every wake-up with RELAY_FORWARD_SECRET; same scheme as client-portals-site.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const sign = (body: string, secret: string) =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

export function verify(body: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}
