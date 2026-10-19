"use client";
// Client side of Web Push (NOT-01). iOS only delivers it to an app installed on the Home Screen, so "not installed" is a state
// of its own with its own instructions, never a silent failure.
import { removePushSubscription, savePushSubscription } from "@/app/actions/reminders";
import { updateProfile } from "@/app/actions/profile";

export type PushSupport = "ready" | "needs-install" | "unsupported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ready";
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? "needs-install" : "unsupported";
}

const key = () => {
  const b64 = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export type EnableResult = { ok: true } | { ok: false; error: string };

/** Must be called from a tap (iOS requires it). Asks permission, subscribes this device, stores the subscription and switches the reminder on. */
export async function enableReminders(): Promise<EnableResult> {
  const support = pushSupport();
  if (support === "needs-install") return { ok: false, error: "Add Sterling to your Home Screen first (Share → Add to Home Screen), then open it from there to turn reminders on." };
  if (support === "unsupported") return { ok: false, error: "This browser can't receive notifications." };
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return { ok: false, error: "Reminders aren't set up on this server yet (no VAPID key)." };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { ok: false, error: "Notifications are blocked. Allow them for Sterling in Settings → Notifications, then try again." };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() as BufferSource }));
    const j = sub.toJSON();
    const saved = await savePushSubscription({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: navigator.userAgent.slice(0, 400) });
    if (!saved.ok) return { ok: false, error: saved.error };
  } catch {
    return { ok: false, error: "Couldn't register this device for reminders. Check your connection and try again." };
  }
  const r = await updateProfile({ reminder_enabled: true, reminder_prompted: true });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Switches the reminder off and forgets this device, so nothing is sent from the next slot. */
export async function disableReminders(): Promise<EnableResult> {
  const r = await updateProfile({ reminder_enabled: false });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    if (pushSupport() === "ready") {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    }
  } catch { /* the reminder is already off server-side */ }
  return { ok: true };
}
