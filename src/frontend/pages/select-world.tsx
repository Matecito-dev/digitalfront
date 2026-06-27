"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMatecitoAuth } from "@/hooks/useMatecitoAuth";
import { useWorlds, type WorldItem } from "@/hooks/useWorlds";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileSelectCarousel } from "@/components/ui/MobileSelectCarousel";
import { SelectBackdrop } from "@/components/SelectBackdrop";
import { GlobeIcon, UsersIcon } from "@/components/landing/MedievalIcons";

const WORLD_ID_KEY = "etheria_world_id";

const SEASON_DISPLAY: Record<string, { icon: string; bg: string; label: string }> = {
  SPRING: { icon: "/assets/ui/seasons/season-spring.png", bg: "/assets/ui/seasons/season-bg-spring.png", label: "Primavera" },
  SUMMER: { icon: "/assets/ui/seasons/season-summer.png", bg: "/assets/ui/seasons/season-bg-summer.png", label: "Verano" },
  AUTUMN: { icon: "/assets/ui/seasons/season-autumn.png", bg: "/assets/ui/seasons/season-bg-autumn.png", label: "Otoño" },
  WINTER: { icon: "/assets/ui/seasons/season-winter.png", bg: "/assets/ui/seasons/season-bg-winter.png", label: "Invierno" },
};

function WorldCard({
  world,
  isSelected,
  onSelect,
  mobile = false,
}: {
  world: WorldItem;
  isSelected: boolean;
  onSelect: () => void;
  mobile?: boolean;
}) {
  const season = world.currentSeason ? SEASON_DISPLAY[world.currentSeason] : null;
  return (
    <button
      onClick={onSelect}
      className={`relative w-full overflow-hidden rounded-2xl border p-6 text-left transition-all duration-200 backdrop-blur-md ${
        mobile ? "flex h-full flex-col" : ""
      } ${
        isSelected
          ? "border-amber-500/60 bg-amber-500/10 shadow-[0_0_28px_rgba(245,158,11,0.2)] scale-[1.02]"
          : "border-etheria-border-dim bg-black/45 hover:border-etheria-border hover:bg-black/55"
      }`}
    >
      {/* Season art banner behind the header */}
      {season && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 overflow-hidden opacity-35">
          <img src={season.bg} alt="" className="h-full w-full object-cover" draggable={false} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b1111]" />
        </div>
      )}
      <div className="relative mb-2 flex items-center gap-3">
        {season ? (
          <img src={season.icon} alt={season.label} className={mobile ? "h-12 w-12 object-contain" : "h-10 w-10 object-contain"} draggable={false} />
        ) : (
          <GlobeIcon className={mobile ? "h-10 w-10" : "h-8 w-8"} />
        )}
        <div>
          <div className={`font-display font-bold text-white ${mobile ? "text-xl" : "text-lg"}`}>
            {world.name}
          </div>
          <div className="text-[11px] uppercase tracking-widest text-stone-500">
            {world.slug}
          </div>
        </div>
        {isSelected && (
          <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-black">
            ✓
          </span>
        )}
      </div>
      {world.description && (
        <p className={`mb-3 leading-relaxed text-stone-400 ${mobile ? "flex-1 text-[14px]" : "text-[13px]"}`}>
          {world.description}
        </p>
      )}
      <div className={`relative flex items-center gap-4 text-stone-400 ${mobile ? "text-[13px]" : "text-[12px]"}`}>
        <span className="inline-flex items-center gap-1.5">
          <UsersIcon className="h-4 w-4" /> {world.playerCount} jugadores
        </span>
        {season && (
          <span className="inline-flex items-center gap-1.5">
            <img src={season.icon} alt="" className="h-4 w-4 object-contain" draggable={false} /> {season.label}
          </span>
        )}
      </div>
    </button>
  );
}

export default function SelectWorldPage() {
  const router = useRouter();
  const auth = useMatecitoAuth();
  const { data: worlds, isLoading } = useWorlds();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!auth.ready || !auth.isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-etheria-bg">
        <GlobeIcon className="h-9 w-9 animate-bounce" />
      </div>
    );
  }

  function handleConfirm() {
    if (!selectedId) return;
    setSubmitting(true);
    localStorage.setItem(WORLD_ID_KEY, selectedId);
    router.replace("/play");
  }

  const selectedName = worlds?.find((w) => w.id === selectedId)?.name;
  const confirmLabel = submitting
    ? "Ingresando..."
    : selectedId
      ? `Ingresar a ${selectedName ?? "Mundo"}`
      : "Selecciona un mundo";

  const loadingBlock = isLoading && (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500" />
        <p className="text-sm text-stone-500">Cargando mundos...</p>
      </div>
    </div>
  );

  const emptyBlock = worlds && worlds.length === 0 && (
    <div className="rounded-2xl border border-etheria-border-dim bg-black/20 p-10 text-center">
      <GlobeIcon className="mx-auto h-14 w-14 opacity-60" />
      <p className="mt-4 text-stone-400">
        No hay mundos disponibles en este momento. Vuelve más tarde.
      </p>
    </div>
  );

  // ─── Mobile: full-screen snap carousel, thumb-zone CTA ───
  if (isMobile) {
    return (
      <div
        className="relative flex h-dvh flex-col bg-[#0b1111]"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
      >
        <SelectBackdrop src="/assets/backgrounds/world-map.webp" />
        <div className="relative z-10 px-6 text-center">
          <h1 className="text-2xl font-display font-bold text-etheria-gold-soft" style={{ letterSpacing: "-0.02em" }}>
            Selecciona tu Mundo
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-400">
            Cada mundo es un reino independiente. Deslizá para explorar.
          </p>
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center py-4">
          {loadingBlock}
          {emptyBlock}
          {worlds && worlds.length > 0 && (
            <MobileSelectCarousel
              items={worlds.map((w) => ({ key: w.id }))}
              onActiveChange={(i) => setSelectedId(worlds[i]?.id ?? null)}
              renderItem={(i, isActive) => (
                <WorldCard mobile world={worlds[i]} isSelected={isActive} onSelect={() => setSelectedId(worlds[i].id)} />
              )}
            />
          )}
        </div>

        {worlds && worlds.length > 0 && (
          <div
            className="relative z-10 px-6"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            <button
              onClick={handleConfirm}
              disabled={!selectedId || submitting}
              className="w-full rounded-xl bg-amber-500 px-6 py-4 text-base font-display font-bold text-white shadow-lg shadow-amber-500/25 transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Desktop: grid ───
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#0b1111] px-4 py-12">
      <SelectBackdrop src="/assets/backgrounds/world-map.webp" />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="mb-10 text-center">
          <h1
            className="mb-3 text-4xl font-display font-bold text-etheria-gold-soft"
            style={{ letterSpacing: "-0.02em" }}
          >
            Selecciona tu Mundo
          </h1>
          <p className="mx-auto max-w-md text-[15px] leading-relaxed text-stone-400">
            Cada mundo es un reino independiente con su propio mapa, temporadas y
            jugadores. Elige sabiamente — tus ciudades pertenecerán a este mundo.
          </p>
        </div>

        {loadingBlock}
        {emptyBlock}

        {worlds && worlds.length > 0 && (
          <div className="grid gap-4">
            {worlds.map((world) => (
              <WorldCard
                key={world.id}
                world={world}
                isSelected={selectedId === world.id}
                onSelect={() => setSelectedId(world.id)}
              />
            ))}
          </div>
        )}

        {worlds && worlds.length > 0 && (
          <>
            <div className="mt-8 flex justify-center">
              <button
                onClick={handleConfirm}
                disabled={!selectedId || submitting}
                className="w-full max-w-xs rounded-xl bg-amber-500 px-6 py-3.5 text-base font-display font-bold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {confirmLabel}
              </button>
            </div>
            <p className="mt-4 text-center text-[12px] text-stone-600">
              Puedes cambiar de mundo más tarde desde la configuración.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
