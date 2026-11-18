import { createHmac } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers of the real-stack e2e suite (`E2E_TARGET=real`): sign in as the seeded demo Owner, compute
 * the TOTP code like an authenticator app, and read mail from Mailpit. Everything here talks to the
 * real API and Mailpit of `docker compose up`; there is no mock.
 */

/** Dev/demo only: apps/api/src/auth/demo-credentials.ts (the seed refuses production). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Passw0rd-2026';
export const DEMO_OWNER_TOTP_SECRET =
  process.env.DEMO_OWNER_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEMO_OWNER = process.env.DEMO_OWNER_EMAIL ?? 'owner@acme.example';

export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error(`not base32: ${char}`);
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) for `secret`, `stepOffset` steps from now. */
export function totp(secret: string, stepOffset = 0, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30) + stepOffset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** A short unique suffix so reruns against the same database never collide (tags, names, emails). */
export function runId(): string {
  return Date.now().toString(36).toUpperCase();
}

/** The visible `role="alert"` messages (Next.js keeps an empty one for route announcements). */
export function alerts(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

/** Signs in as the demo Owner through the login screen, including the TOTP step. */
export async function signInAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(DEMO_OWNER);
  await page.getByLabel(/^Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel(/^Authentication code/);
  await expect(code).toBeVisible();
  // The API refuses a TOTP step it already accepted (replay protection), so a rerun inside the same
  // 30 s step needs the next step's code (the window accepts +1); wait out the step if even that fails.
  const dashboard = page.getByRole('heading', { level: 1, name: 'Dashboard' });
  for (const offset of [0, 1, 1]) {
    await code.fill(totp(DEMO_OWNER_TOTP_SECRET, offset));
    await page.getByRole('button', { name: 'Verify' }).click();
    const ok = await expect(dashboard)
      .toBeVisible({ timeout: 4_000 })
      .then(
        () => true,
        () => false,
      );
    if (ok) return;
    await page.waitForTimeout(offset === 1 ? 31_000 : 0);
  }
  await expect(dashboard).toBeVisible();
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
  Snippet: string;
}

/** Waits (polling Mailpit) for a message to `to` and returns it with its text body. */
export async function waitForMail(
  to: string,
  timeoutMs = 30_000,
): Promise<MailpitMessage & { Text: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailpitMessage[] };
      const found = body.messages?.[0];
      if (found) {
        const full = await fetch(`${MAILPIT_URL}/api/v1/message/${found.ID}`);
        const detail = (await full.json()) as { Text?: string };
        return { ...found, Text: detail.Text ?? '' };
      }
    }
    if (Date.now() > deadline) throw new Error(`no mail to ${to} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Opens a select (Radix combobox) by its label and picks an option. */
export async function choose(page: Page, label: RegExp | string, option: RegExp | string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}
