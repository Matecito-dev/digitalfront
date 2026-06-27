"use client";

import { useEffect, useState } from "react";
import { useBarbarianAttackAlerts, useMarkBarbarianAlertRead } from "@/hooks/useCity";
import { useGameStore } from "@/stores/gameStore";

const ARCHETYPE_ICONS: Record<string, string> = {
  RAIDERS: "⚔️",
  HUNTERS: "🏹",
  MARAUDERS: "🔥",
  WARHOST: "💀",
  NOMADS: "🐎",
};

export function BarbarianAttackAlertBanner() {
  const cityId = useGameStore((s) => s.cityId);
  const storeAlerts = useGameStore((s) => s.barbarianAlerts);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const { data: alerts } = useBarbarianAttackAlerts(cityId, pollingEnabled);
  const markRead = useMarkBarbarianAlertRead();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = window.setTimeout(() => setPollingEnabled(true), 12_000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (alerts) useGameStore.getState().setBarbarianAlerts(alerts);
  }, [alerts]);

  const visibleAlerts = alerts ?? storeAlerts;
  if (!visibleAlerts || visibleAlerts.length === 0) return null;

  const activeAlerts = visibleAlerts.filter(
    (a) => !a.read && !dismissed.has(a.id) && new Date(a.arrivesAt) > new Date()
  );
  if (activeAlerts.length === 0) return null;

  const urgentAlert = activeAlerts.sort(
    (a, b) => new Date(a.arrivesAt).getTime() - new Date(b.arrivesAt).getTime()
  )[0];

  const timeUntilArrival = Math.max(0, Math.floor((new Date(urgentAlert.arrivesAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(timeUntilArrival / 60);
  const seconds = timeUntilArrival % 60;

  return (
    <div className="fixed top-[calc(var(--topbar-height)+8px)] md:top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/95 px-4 py-2.5 shadow-lg shadow-red-900/10 backdrop-blur-xl">
        <span className="flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-xl bg-red-500 text-white text-lg">
          {ARCHETYPE_ICONS[urgentAlert.archetype] ?? "⚔️"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-red-800">¡Ataque entrante! {urgentAlert.campName}</div>
          <div className="text-[11.5px] text-red-600">{urgentAlert.archetype} · poder ~{urgentAlert.estimatedPower}</div>
        </div>
        <div className="rounded-lg bg-red-500 px-3 py-1.5 text-[14px] font-bold tabular-nums text-white">
          {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
        </div>
        <button
          onClick={() => {
            setDismissed((prev) => new Set([...prev, urgentAlert.id]));
            markRead.mutate({ alertId: urgentAlert.id });
          }}
          className="text-red-400 hover:text-red-600 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
