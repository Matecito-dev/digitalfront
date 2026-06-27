"use client";

import { useState } from "react";
import { useWinterPressure } from "@/hooks/useCity";
import { useGameStore } from "@/stores/gameStore";

const ZONE_NAMES_ES: Record<string, string> = {
  NORTH: "Norte Helado",
  CENTER: "Centro Templado",
  SOUTH: "Sur Cálido",
  COAST: "Costa",
  MOUNTAIN: "Montaña",
  FOREST: "Bosque",
  PLAINS: "Llanura",
};

function formatHours(hours: number): string {
  if (hours === Infinity || hours > 9999) return "--";
  if (hours < 1) return `${Math.floor(hours * 60)}min`;
  return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}min`;
}

export function WinterPressureBanner() {
  const cityId = useGameStore((s) => s.cityId);
  const seasonState = useGameStore((s) => s.seasonState);
  const { data, isLoading } = useWinterPressure(cityId, seasonState?.currentSeason === "WINTER");
  const [collapsed, setCollapsed] = useState(false);

  if (isLoading || !data || !data.isWinter) return null;

  const isStarving = data.winterState?.isStarving ?? false;
  const hasDeficit = data.netFoodPerHour < 0;
  const hoursUntilStarvation = data.hoursUntilStarvation;
  const isCritical = isStarving || (hasDeficit && hoursUntilStarvation < 4);
  const isWarning = hasDeficit && hoursUntilStarvation < 12;

  if (!isCritical && !isWarning && !isStarving) return null;

  const borderColor = isCritical ? "border-red-200" : "border-amber-200";
  const bgColor = isCritical ? "bg-red-50/95" : "bg-amber-50/95";
  const textColor = isCritical ? "text-red-700" : "text-amber-700";
  const titleColor = isCritical ? "text-red-800" : "text-amber-800";
  const iconBg = isCritical ? "bg-red-500" : "bg-amber-500";

  if (collapsed) {
    return (
      <div className="fixed top-[calc(var(--topbar-height)+8px)] md:top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <button
          onClick={() => setCollapsed(false)}
          className={`pointer-events-auto rounded-2xl border ${borderColor} ${bgColor} px-3 py-1.5 text-xs ${titleColor} shadow-lg backdrop-blur-xl hover:opacity-80`}
        >
          {isCritical ? "⚠️ Hambruna activa" : "❄️ Presión invernal"}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-[calc(var(--topbar-height)+8px)] md:top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className={`pointer-events-auto flex items-center gap-3 rounded-2xl border ${borderColor} ${bgColor} px-4 py-2.5 shadow-lg shadow-stone-900/8 backdrop-blur-xl`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg} text-white text-lg`}>
          {isCritical ? "⚠️" : "❄️"}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-bold ${titleColor}`}>
            {isCritical ? "Hambruna Activa" : "Presión Invernal"}
            <span className="ml-2 text-[11px] font-normal opacity-70">
              ({ZONE_NAMES_ES[data.zone.id] ?? data.zone.id}: {data.zone.intensity}x)
            </span>
          </div>
          <div className={`text-[11.5px] ${textColor} space-y-0.5`}>
            {isStarving && (
              <p>Hambruna activa desde hace {data.winterState?.starvationHours ?? 0}h
                {data.winterState && data.winterState.combatPenalty < 1 && (
                  <span> · Penalidad combate: {Math.round((1 - data.winterState.combatPenalty) * 100)}%</span>
                )}
              </p>
            )}
            {hasDeficit && !isStarving && (
              <p>Déficit: {Math.abs(Math.round(data.netFoodPerHour))} comida/h
                {hoursUntilStarvation < Infinity && (
                  <span> · Hambruna en ~{formatHours(hoursUntilStarvation)}</span>
                )}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className={`shrink-0 ${textColor} opacity-60 hover:opacity-100 transition-opacity`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
