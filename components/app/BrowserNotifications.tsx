"use client";

import { useCallback, useEffect, useState } from "react";

const CURSOR_KEY = "investogenie.browserNotifications.cursor";

interface BrowserEvent { id: string; title: string; body: string; route: string; signature: string }

export default function BrowserNotifications() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    const timer = window.setTimeout(() => setPermission("Notification" in window ? Notification.permission : "unsupported"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const enable = useCallback(async () => {
    if (!("Notification" in window)) return;
    const next = await Notification.requestPermission();
    setPermission(next);
    if (next === "granted") {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.register("/browser-notifications-sw.js");
        await registration.showNotification("InvestoGenie browser alerts enabled", {
          body: "You will be notified about ready candidates and material trade actions while InvestoGenie is open.",
          tag: "investogenie:enabled", data: { route: window.location.pathname },
        });
      } else {
        new Notification("InvestoGenie browser alerts enabled", {
          body: "You will be notified about ready candidates and material trade actions while InvestoGenie is open.",
          tag: "investogenie:enabled",
        });
      }
    }
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    let stopped = false;
    const worker = "serviceWorker" in navigator
      ? navigator.serviceWorker.register("/browser-notifications-sw.js")
      : Promise.resolve(null);
    const poll = async () => {
      try {
        const existing = localStorage.getItem(CURSOR_KEY);
        const response = await fetch(`/api/browser-notifications${existing ? `?after=${encodeURIComponent(existing)}` : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { cursor: string; events: BrowserEvent[] };
        if (stopped) return;
        localStorage.setItem(CURSOR_KEY, payload.cursor);
        for (const event of payload.events) {
          const registration = await worker;
          if (registration) {
            await registration.showNotification(event.title, {
              body: event.body, tag: `investogenie:${event.id}`, data: { route: event.route },
            });
          } else {
            const notification = new Notification(event.title, { body: event.body, tag: `investogenie:${event.id}` });
            notification.onclick = () => { window.focus(); window.location.assign(event.route); notification.close(); };
          }
        }
      } catch { /* A transient browser/network failure is retried on the next poll. */ }
    };
    void poll();
    const timer = window.setInterval(poll, 30_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [permission]);

  if (permission === "unsupported") return null;
  if (permission === "granted") return <span title="Browser alerts enabled" className="inline-flex min-h-9 items-center rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 text-xs font-semibold text-emerald-200">🔔 Alerts on</span>;
  if (permission === "denied") return <span title="Enable notifications in this browser's site settings" className="inline-flex min-h-9 items-center rounded-lg border border-amber-400/25 px-3 text-xs font-semibold text-amber-200">Alerts blocked</span>;
  return <button type="button" onClick={enable} className="min-h-9 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/70 hover:bg-white/[0.08]">Enable browser alerts</button>;
}

