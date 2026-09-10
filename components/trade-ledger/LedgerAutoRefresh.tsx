"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function marketIsOpen(market: "IN" | "US", now = new Date()): boolean {
  const timeZone = market === "IN" ? "Asia/Kolkata" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return market === "IN"
    ? minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30
    : minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

export default function LedgerAutoRefresh({ market }: { market: "IN" | "US" }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (marketIsOpen(market)) router.refresh();
    };
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [market, router]);

  return null;
}
