import "server-only";
import { appendFileSync } from "node:fs";
import webpush from "web-push";

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushPayload {
  title: string; body: string; url: string;
  /** Replaces a notification with the same tag (default: the evening reminder's). */
  tag?: string;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
}
export type PushResult = { ok: true } | { ok: false; gone: boolean; status?: number };

/**
 * Sends one Web Push. With STERLING_PUSH_STUB=<file> (tests only) the payload is appended to that file instead of leaving the
 * machine, and an endpoint containing "gone" answers 410, so the whole nudge path runs without a push service.
 */
export async function sendPush(t: PushTarget, payload: PushPayload): Promise<PushResult> {
  const stub = process.env.STERLING_PUSH_STUB;
  if (stub) {
    if (t.endpoint.includes("gone")) return { ok: false, gone: true, status: 410 };
    appendFileSync(stub, `${JSON.stringify({ endpoint: t.endpoint, ...payload })}\n`);
    return { ok: true };
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) throw new Error("VAPID keys are not configured. See .env.example.");
  try {
    await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), {
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }, TTL: 60 * 60 * 3, urgency: "normal", ...(payload.tag ? {} : { topic: "evening-reminder" }),
    });
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410, status };
  }
}
