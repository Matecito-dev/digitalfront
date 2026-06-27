"use client";

import { useEffect, useRef, useCallback } from "react";
import { Application, Container } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { WorldMovement, WorldRegion, WorldPOI } from "@etheria/shared";
import { useI18n } from "@/i18n";
import { getIsMobileNow } from "@/hooks/useIsMobile";
import type { WorldTerrainMaskData } from "@/lib/worldTerrainMask";
import type { TerrainKind } from "@/lib/worldTerrainMask";
import { TileLayer } from "./pixi/tileLayer";
import { OverlayLayer } from "./pixi/overlays";
import { MarkersLayer } from "./pixi/markers";
import { MovementsLayer } from "./pixi/movements";
import { EditorLayer } from "./pixi/editor";

type WorldCity = {
  id: string; name: string; posX: number; posY: number;
  level?: number; allianceId?: string | null;
  relation?: "ally" | "peace" | "hostile" | "neutral";
};
type BarbarianCamp = {
  id: string; name: string; level: number; archetype: string;
  posX: number; posY: number; status: string; estimatedPower: number;
};
type MapConfig = {
  width: number; height: number; cameraMinZoom: number; cameraMaxZoom: number;
  cameraInitialZoom: number; backgroundAssetPath: string; terrainVersion?: string;
};

export function WorldMapPixi({
  cities,
  mapConfig,
  myCityId,
  onSelectCityId,
  onCenterMyCity,
  onDoubleClickMyCity,
  barbarianCamps = [],
  onSelectCamp,
  movements = [],
  seasonState,
  editorMode = false,
  terrainMask,
  selectedTerrain,
  brushSize = 2,
  showTerrainOverlay = true,
  terrainTool = "brush",
  onTerrainChange,
  onPickTerrain,
}: {
  cities: WorldCity[];
  mapConfig: MapConfig | null;
  myCityId?: string | null;
  onSelectCityId?: (cityId: string, position: { x: number; y: number }) => void;
  onCenterMyCity?: () => void;
  onDoubleClickMyCity?: () => void;
  barbarianCamps?: BarbarianCamp[];
  onSelectCamp?: (camp: BarbarianCamp, position: { x: number; y: number }) => void;
  movements?: (WorldMovement & { relation?: "ally" | "peace" | "hostile" | "neutral" | "own" })[];
  seasonState?: any;
  editorMode?: boolean;
  terrainMask?: WorldTerrainMaskData | null;
  selectedTerrain?: TerrainKind;
  brushSize?: number;
  showTerrainOverlay?: boolean;
  terrainTool?: "brush" | "fill" | "picker";
  onTerrainChange?: (mask: WorldTerrainMaskData) => void;
  onPickTerrain?: (kind: TerrainKind) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const overlayRef = useRef<OverlayLayer | null>(null);
  const markersRef = useRef<MarkersLayer | null>(null);
  const movementsRef = useRef<MovementsLayer | null>(null);
  const editorRef = useRef<EditorLayer | null>(null);
  const isPainting = useRef(false);
  // Throttle refs
  const lastMoveTick = useRef(0);
  const lastTileTick = useRef(0);
  const lastScaleTick = useRef(0);
  const hasInited = useRef(false);

  // Expose t and callbacks in refs to avoid stale closures in ticker
  const tRef = useRef(t);
  tRef.current = t;
  const mapConfigRef = useRef(mapConfig);
  mapConfigRef.current = mapConfig;
  const onSelectCityIdRef = useRef(onSelectCityId);
  onSelectCityIdRef.current = onSelectCityId;
  const onSelectCampRef = useRef(onSelectCamp);
  onSelectCampRef.current = onSelectCamp;
  const terrainMaskRef = useRef(terrainMask);
  terrainMaskRef.current = terrainMask;
  const selectedTerrainRef = useRef(selectedTerrain);
  selectedTerrainRef.current = selectedTerrain;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;
  const terrainToolRef = useRef(terrainTool);
  terrainToolRef.current = terrainTool;
  const onTerrainChangeRef = useRef(onTerrainChange);
  onTerrainChangeRef.current = onTerrainChange;
  const onPickTerrainRef = useRef(onPickTerrain);
  onPickTerrainRef.current = onPickTerrain;
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;

  // ─── Init Pixi Application ────────────────────────────────────────────────
  useEffect(() => {
    if (hasInited.current) return;
    hasInited.current = true;
    const el = containerRef.current;
    if (!el) return;

    let destroyed = false;
    const disposers: Array<() => void> = [];

    (async () => {
      // Bug 1 fix: leer mobile sincrónicamente — useIsMobile() llega null en el primer render
      const isMobileNow = getIsMobileNow();
      try {

      const app = new Application();
      await app.init({
        preference: "webgpu",
        resizeTo: el,
        backgroundColor: 0x247fc0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
      if (destroyed) { app.destroy(true); return; }
      const cvs = app.canvas as HTMLCanvasElement;
      cvs.style.display = "block";
      el.appendChild(cvs);
      appRef.current = app;

      const cfg = mapConfigRef.current;
      const worldW = cfg?.width ?? 80000;
      const worldH = cfg?.height ?? 80000;
      const halfW = worldW / 2;
      const halfH = worldH / 2;

      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: worldW,
        worldHeight: worldH,
        events: app.renderer.events,
      });
      viewport
        .drag({ mouseButtons: "middle-right" })
        .pinch()
        .wheel({ smooth: 5 })
        .decelerate({ friction: 0.92 })
        // Contenido centrado en origen (-halfW,-halfH)→(halfW,halfH) — clamp explícito
        .clamp({ left: -halfW, right: halfW, top: -halfH, bottom: halfH })
        .clampZoom({
          minScale: cfg?.cameraMinZoom ?? 0.01,
          maxScale: cfg?.cameraMaxZoom ?? 2.2,
        });
      viewport.moveCenter(0, 0);
      viewportRef.current = viewport;
      app.stage.addChild(viewport);

      // ── World layers (all go into viewport) ─────────────────────────────
      const overlay = new OverlayLayer(worldW, worldH, viewport);
      const tileLayer = new TileLayer(worldW, worldH, viewport, isMobileNow, cfg?.terrainVersion ?? "");
      const markers = new MarkersLayer(viewport);
      const movLayer = new MovementsLayer(viewport, (k: string) => tRef.current(k));
      const editorLayer = new EditorLayer(viewport, worldW, worldH);

      viewport.addChild(overlay);
      viewport.addChild(tileLayer);
      viewport.addChild(markers);
      viewport.addChild(movLayer);
      if (editorModeRef.current) viewport.addChild(editorLayer);

      overlayRef.current = overlay;
      tileLayerRef.current = tileLayer;
      markersRef.current = markers;
      movementsRef.current = movLayer;
      editorRef.current = editorLayer;

      // Set z-orders
      overlay.zIndex = 0;
      tileLayer.zIndex = 5;
      markers.zIndex = 20;
      movLayer.zIndex = 15;
      editorLayer.zIndex = 25;
      viewport.sortableChildren = true;

      // ── Load async resources ─────────────────────────────────────────────
      overlay.loadWater();
      overlay.loadOverview(isMobileNow, cfg?.terrainVersion ?? "");
      overlay.loadRegionBorders();
      markers.loadTextures();

      // Load regions + POIs
      fetch("/api/world/regions").then(r => r.json()).then((d: { regions: WorldRegion[] }) => {
        if (destroyed) return;
        overlay.setRegions(d.regions ?? []);
        overlay.setGeoFeatures([]);
      }).catch(() => {});
      fetch("/api/world/points-of-interest").then(r => r.json()).then((d: { pois: WorldPOI[] }) => {
        if (destroyed) return;
        overlay.setGeoFeatures(d.pois ?? []);
        overlay.setPOIs(d.pois ?? []);
      }).catch(() => {});

      // ── Initial camera center ────────────────────────────────────────────
      if (cfg) {
        const firstCity = cities.find(c => c.id === myCityId) ?? cities[0];
        const initZoom = cfg.cameraInitialZoom;
        viewport.setZoom(initZoom, true);
        if (firstCity) viewport.moveCenter(firstCity.posX, firstCity.posY);
        else viewport.moveCenter(0, 0);
      }

      // ── Editor pointer events ────────────────────────────────────────────
      const canvas = app.canvas as HTMLCanvasElement;
      const handlePointerDown = (e: PointerEvent) => {
        if (!editorModeRef.current) return;
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const wp = viewportRef.current!.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const tool = terrainToolRef.current;
        const mask = terrainMaskRef.current;
        const sel = selectedTerrainRef.current;
        const ed = editorRef.current;
        if (!mask || !ed) return;
        if (tool === "picker") {
          const kind = ed.pickTerrain(wp.x, wp.y, mask);
          if (kind) onPickTerrainRef.current?.(kind);
          return;
        }
        if (tool === "fill") {
          if (!sel) return;
          const newMask = ed.floodFill(wp.x, wp.y, mask, sel);
          onTerrainChangeRef.current?.(newMask);
          ed.redrawOverlay(newMask, true);
          return;
        }
        isPainting.current = true;
        if (sel) {
          const newMask = ed.paintCell(wp.x, wp.y, brushSizeRef.current, mask, sel);
          onTerrainChangeRef.current?.(newMask);
          ed.redrawOverlay(newMask, true);
        }
      };
      const handlePointerMove = (e: PointerEvent) => {
        if (!editorModeRef.current) return;
        const rect = canvas.getBoundingClientRect();
        const wp = viewportRef.current!.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const mask = terrainMaskRef.current;
        const ed = editorRef.current;
        if (ed && mask) ed.drawBrushCursor(wp.x, wp.y, brushSizeRef.current, mask, selectedTerrainRef.current);
        if (!isPainting.current || e.buttons !== 1) return;
        const sel = selectedTerrainRef.current;
        if (!sel || !mask) return;
        const newMask = ed!.paintCell(wp.x, wp.y, brushSizeRef.current, mask, sel);
        onTerrainChangeRef.current?.(newMask);
        ed!.redrawOverlay(newMask, true);
      };
      const handlePointerUp = () => { isPainting.current = false; };
      canvas.addEventListener("pointerdown", handlePointerDown);
      canvas.addEventListener("pointermove", handlePointerMove);
      canvas.addEventListener("pointerup", handlePointerUp);
      canvas.addEventListener("pointercancel", handlePointerUp);

      // ── Main ticker ──────────────────────────────────────────────────────
      app.ticker.add(() => {
        const now = performance.now();
        const scale = viewport.scale.x;

        // Tile LOD ~8fps
        if (now - lastTileTick.current > 120) {
          lastTileTick.current = now;
          tileLayerRef.current?.update();
        }
        // Movement animation ~7fps
        if (now - lastMoveTick.current > 140) {
          lastMoveTick.current = now;
          movementsRef.current?.update();
        }
        // Counter-scale ~10fps
        if (now - lastScaleTick.current > 100) {
          lastScaleTick.current = now;
          markersRef.current?.updateScales(scale);
          overlayRef.current?.updateScales(scale);
        }
      });

      // ── Resize ──────────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        if (!el) return;
        app.renderer.resize(el.clientWidth, el.clientHeight);
        viewport.resize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);

      // Bug 2 fix: registrar disposers en scope del effect, no dentro del IIFE
      disposers.push(
        () => ro.disconnect(),
        () => canvas.removeEventListener("pointerdown", handlePointerDown),
        () => canvas.removeEventListener("pointermove", handlePointerMove),
        () => canvas.removeEventListener("pointerup", handlePointerUp),
        () => canvas.removeEventListener("pointercancel", handlePointerUp),
      );
      } catch (err) {
        console.error("[WorldMapPixi] init failed:", err);
      }
    })();

    return () => {
      destroyed = true;
      for (const d of disposers) { try { d(); } catch {} }
      const app = appRef.current;
      if (app) { try { app.destroy(true, { children: true }); } catch {} appRef.current = null; }
      hasInited.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // ─── Update markers when props change ────────────────────────────────────
  useEffect(() => {
    markersRef.current?.setCallbacks(
      myCityId ?? null,
      (id, pos) => onSelectCityId?.(id, pos),
      (camp, pos) => onSelectCamp?.(camp, pos),
      onDoubleClickMyCity,
    );
    markersRef.current?.setCities(cities);
  }, [cities, myCityId, onSelectCityId, onSelectCamp, onDoubleClickMyCity]);

  useEffect(() => {
    markersRef.current?.setCamps(barbarianCamps);
  }, [barbarianCamps]);

  useEffect(() => {
    movementsRef.current?.setMovements(movements);
  }, [movements]);

  useEffect(() => {
    overlayRef.current?.applyWeather(seasonState);
  }, [seasonState]);

  // Re-center camera when mapConfig arrives (init may have run before data loaded)
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (!mapConfig || didCenterRef.current) return;
    const vp = viewportRef.current;
    if (!vp) return;
    didCenterRef.current = true;
    const firstCity = cities.find(c => c.id === myCityId) ?? cities[0];
    vp.setZoom(mapConfig.cameraInitialZoom, true);
    if (firstCity) vp.moveCenter(firstCity.posX, firstCity.posY);
    else vp.moveCenter(0, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapConfig]);

  useEffect(() => {
    const ed = editorRef.current;
    const vp = viewportRef.current;
    if (!ed || !vp) return;
    ed.redrawOverlay(terrainMask ?? null, showTerrainOverlay);
  }, [terrainMask, showTerrainOverlay]);

  // ─── Center on my city ────────────────────────────────────────────────────
  const centerOnMyCity = useCallback(() => {
    const vp = viewportRef.current;
    const cfg = mapConfigRef.current;
    if (!vp || !cfg) return;
    const target = cities.find(c => c.id === myCityId) ?? cities[0];
    if (target) {
      vp.animate({ position: { x: target.posX, y: target.posY }, scale: cfg.cameraInitialZoom, time: 600 });
    }
    onCenterMyCity?.();
  }, [cities, myCityId, onCenterMyCity]);

  return (
    <div className="relative h-full w-full">
      {/* Loading overlay — visible hasta que mapConfig cargue. El div del canvas
          siempre está montado para que el useEffect pueda inicializar Pixi. */}
      {!mapConfig && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a1e48] gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
          <p className="text-stone-500 text-xs">Cargando mapa...</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="h-full w-full select-none md:rounded-lg md:border md:border-etheria-border/30"
        style={{ touchAction: "none" }}
      />
      {/* Top-right controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => { const vp = viewportRef.current; if (vp) vp.zoom(1.25, true); }}
          className="w-8 h-8 rounded-lg border border-etheria-border bg-black/55 text-etheria-gold-soft backdrop-blur-[2px] hover:bg-black/75 text-base font-bold flex items-center justify-center"
          aria-label="Zoom in">+</button>
        <button
          type="button"
          onClick={() => { const vp = viewportRef.current; if (vp) vp.zoom(0.8, true); }}
          className="w-8 h-8 rounded-lg border border-etheria-border bg-black/55 text-etheria-gold-soft backdrop-blur-[2px] hover:bg-black/75 text-base font-bold flex items-center justify-center"
          aria-label="Zoom out">−</button>
        {!editorMode && (
          <button
            type="button"
            onClick={centerOnMyCity}
            className="rounded-lg border border-etheria-border bg-black/55 px-3 h-8 text-xs text-etheria-gold-soft backdrop-blur-[2px] hover:bg-black/75"
          >
            {t("play.map.centerMyVillage")}
          </button>
        )}
      </div>

      {/* Bottom-left legend */}
      {!editorMode && (
        <div className="absolute left-3 bottom-3 z-10 flex flex-col gap-1 rounded-lg bg-black/50 px-2 py-1.5 backdrop-blur-sm pointer-events-none">
          {([
            ["#e8c468", t("play.map.legend.own")],
            ["#49f0c5", t("play.map.legend.ally")],
            ["#6fc8ff", t("play.map.legend.peace")],
            ["#d75f43", t("play.map.legend.hostile")],
          ] as [string, string][]).map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[9px] text-white/55 leading-none">{label}</span>
            </div>
          ))}
          <div className="mt-0.5 border-t border-white/10 pt-0.5 flex flex-col gap-1">
            {([
              ["▲", "#d75f43", t("play.map.legend.attack")],
              ["◆", "#ffe066", t("play.map.legend.trade")],
              ["●", "#c8a060", t("play.map.legend.barbMove")],
            ] as [string, string, string][]).map(([shape, color, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-[9px] w-2 text-center leading-none shrink-0" style={{ color }}>{shape}</span>
                <span className="text-[9px] text-white/55 leading-none">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
