"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { useGameStore } from "@/stores/gameStore";
import { useBarbarianCampDetail, useAttackBarbarianCamp, useScoutTarget } from "@/hooks/useCity";
import { useToastStore } from "@/stores/toastStore";
import { hapticHeavy } from "@/lib/native";

type UnitType = "WARRIOR" | "ARCHER" | "CAVALRY" | "SIEGE" | "SPY";

const ARCHETYPE_LABELS: Record<string, string> = {
  RAIDERS: "Raiders",
  HUNTERS: "Hunters",
  MARAUDERS: "Marauders",
  WARHOST: "Warhost",
  NOMADS: "Nomads",
};

const UNIT_LABELS: Record<UnitType, string> = {
  WARRIOR: "Warriors",
  ARCHER: "Archers",
  CAVALRY: "Cavalry",
  SIEGE: "Siege",
  SPY: "Spies",
};

const UNIT_ICONS: Record<UnitType, string> = {
  WARRIOR: "⚔️",
  ARCHER: "🏹",
  CAVALRY: "🐴",
  SIEGE: "🔨",
  SPY: "🕵️",
};

export function BarbarianCampModal() {
  const { selectedCamp, showCampModal, setShowCampModal, setSelectedCamp, units } = useGameStore();
  const [selectedUnits, setSelectedUnits] = useState<Record<UnitType, number>>({
    WARRIOR: 0, ARCHER: 0, CAVALRY: 0, SIEGE: 0, SPY: 0,
  });
  const { data, isLoading } = useBarbarianCampDetail(selectedCamp?.id ?? null);
  const attackCamp = useAttackBarbarianCamp();
  const scoutTarget = useScoutTarget();
  const addToast = useToastStore((s) => s.addToast);

  const cityId = useGameStore((s) => s.cityId);

  const totalSelected = Object.values(selectedUnits).reduce((s, v) => s + v, 0);
  const canAttack = totalSelected > 0 && !!cityId && !attackCamp.isPending;

  const handleAttack = async () => {
    if (!selectedCamp || !cityId || !canAttack) return;

    const attackUnits = Object.entries(selectedUnits)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));

    hapticHeavy();
    const result = await attackCamp.mutateAsync({
      campId: selectedCamp.id,
      cityId,
      units: attackUnits,
    });

    // Battle is MARCHING — units travel to the camp, result resolves later via worker
    const seconds = result.travelTime ?? 0;
    const etaText = seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
    addToast({ type: "success", title: "¡Fuerzas en marcha!", message: `Tu ejército llegará al campamento en ${etaText}.` });
    setShowCampModal(false);
    setSelectedCamp(null);
    setSelectedUnits({ WARRIOR: 0, ARCHER: 0, CAVALRY: 0, SIEGE: 0, SPY: 0 });
  };

  const handleScout = () => {
    if (!selectedCamp || !cityId || scoutTarget.isPending) return;
    scoutTarget.mutate(
      { cityId, targetType: "BARBARIAN_CAMP", targetId: selectedCamp.id },
      {
        onSuccess: () => addToast({ type: "success", title: "Espionaje", message: "Reporte de campamento creado sin revelar niebla." }),
        onError: (error) => addToast({ type: "error", title: "Espionaje", message: error.message }),
      }
    );
  };

  const adjustUnit = (type: UnitType, delta: number) => {
    const available = units?.find((u) => u.type === type)?.count ?? 0;
    setSelectedUnits((prev) => ({
      ...prev,
      [type]: Math.max(0, Math.min(available, prev[type] + delta)),
    }));
  };

  if (!showCampModal || !selectedCamp) return null;

  const archetypeLabel = ARCHETYPE_LABELS[selectedCamp.archetype] ?? selectedCamp.archetype;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Panel variant="default" animation="fade" className="w-full max-w-md max-sm:max-w-[calc(100vw-16px)] p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-etheria-border/40 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-etheria-gold">{selectedCamp.name}</h2>
            <p className="text-xs text-etheria-text-muted">{archetypeLabel} &middot; Level {selectedCamp.level}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCampModal(false);
              setSelectedCamp(null);
            }}
            className="rounded-md p-1 text-etheria-text-muted hover:bg-etheria-border/20 hover:text-etheria-gold-soft"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-etheria-text-muted">
              <span className="text-sm">Loading camp details...</span>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Power */}
              <div className="flex items-center justify-between rounded-md bg-etheria-border/10 px-3 py-2">
                <span className="text-sm text-etheria-text-muted">Estimated Power</span>
                <span className="text-sm font-semibold text-etheria-gold">{data.army.power}</span>
              </div>

              {/* Army composition */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-etheria-gold-soft">Enemy Army</h3>
                <div className="space-y-1">
                  {Object.entries(data.army.units).map(([type, count]) => (
                    count > 0 && (
                      <div key={type} className="flex items-center justify-between text-sm">
                        <span className="text-etheria-text-muted">{UNIT_LABELS[type as UnitType] ?? type}</span>
                        <span className="font-medium text-red-300">{count}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>

              {/* Estimated rewards */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-etheria-gold-soft">Estimated Rewards</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-etheria-border/10 px-3 py-2">
                    <span className="text-xs text-etheria-text-muted">Gold</span>
                    <p className="text-sm font-semibold text-yellow-400">{data.estimatedReward.gold.toLocaleString()}</p>
                  </div>
                  <div className="rounded-md bg-etheria-border/10 px-3 py-2">
                    <span className="text-xs text-etheria-text-muted">Wood</span>
                    <p className="text-sm font-semibold text-green-400">{data.estimatedReward.wood.toLocaleString()}</p>
                  </div>
                  <div className="rounded-md bg-etheria-border/10 px-3 py-2">
                    <span className="text-xs text-etheria-text-muted">Stone</span>
                    <p className="text-sm font-semibold text-stone-400">{data.estimatedReward.stone.toLocaleString()}</p>
                  </div>
                  <div className="rounded-md bg-etheria-border/10 px-3 py-2">
                    <span className="text-xs text-etheria-text-muted">Food</span>
                    <p className="text-sm font-semibold text-orange-400">{data.estimatedReward.food.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* Unit selection */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-etheria-gold-soft">Your Forces</h3>
                <div className="space-y-2">
                  {(Object.keys(UNIT_LABELS) as UnitType[]).map((type) => {
                    const available = units?.find((u) => u.type === type)?.count ?? 0;
                    if (available === 0) return null;
                    const selected = selectedUnits[type];
                    return (
                      <div key={type} className="flex items-center justify-between rounded-md bg-etheria-border/10 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{UNIT_ICONS[type]}</span>
                          <span className="text-sm text-etheria-text-muted">{UNIT_LABELS[type]}</span>
                          <span className="text-xs text-etheria-text-muted">({available})</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => adjustUnit(type, -10)}
                            className="rounded px-2 py-1 text-xs bg-etheria-border/20 text-etheria-text-muted hover:bg-etheria-border/30"
                          >
                            -10
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustUnit(type, -1)}
                            className="rounded px-2 py-1 text-xs bg-etheria-border/20 text-etheria-text-muted hover:bg-etheria-border/30"
                          >
                            -1
                          </button>
                          <span className="w-10 text-center text-sm font-semibold text-etheria-gold">{selected}</span>
                          <button
                            type="button"
                            onClick={() => adjustUnit(type, 1)}
                            className="rounded px-2 py-1 text-xs bg-etheria-border/20 text-etheria-text-muted hover:bg-etheria-border/30"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustUnit(type, 10)}
                            className="rounded px-2 py-1 text-xs bg-etheria-border/20 text-etheria-text-muted hover:bg-etheria-border/30"
                          >
                            +10
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalSelected > 0 && (
                  <p className="mt-2 text-xs text-etheria-gold-soft">Total: {totalSelected} units selected</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-red-400">
              <span className="text-sm">Failed to load camp details</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-etheria-border/40 px-4 py-3">
          <button
            type="button"
            onClick={handleScout}
            disabled={!cityId || scoutTarget.isPending}
            className="mb-2 w-full rounded-md border border-etheria-gold/40 px-4 py-2 text-sm font-medium text-etheria-gold-soft hover:bg-etheria-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scoutTarget.isPending ? "Espiando..." : "Espiar campamento"}
          </button>
          <button
            type="button"
            onClick={handleAttack}
            disabled={!canAttack}
            className="w-full rounded-md bg-red-600/30 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-600/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {attackCamp.isPending ? "Attacking..." : totalSelected > 0 ? `Attack with ${totalSelected} units` : "Select units to attack"}
          </button>
          {attackCamp.error && (
            <p className="mt-2 text-xs text-red-400 text-center">
              {(attackCamp.error as Error).message}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
