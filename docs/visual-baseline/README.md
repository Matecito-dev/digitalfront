# Baseline visual — Digital Front (Phaser viewer)

Capturas de referencia para detectar regresiones visuales durante la optimización MMO. **No degradar** la fidelidad en vista táctica: tiles HD 128×128, filtro LINEAR, unidades y FX completos.

## Entorno fijo

| Parámetro | Valor |
|-----------|--------|
| Seed | `valle-bruma` |
| Mundo | **Valle de Bruma** |
| Zoom | Táctico (`TACTICAL_ZOOM` ≈ 220 %, tecla **F** / botón **Seguir escuadrón**) |
| Resolución ventana | 1920×1080 (desktop) o 390×844 (móvil emulado) |
| Servidor | `npm run viewer` en `worldgen/` |

## Cómo capturar

1. Arrancar el viewer: `cd worldgen && npm run viewer`
2. Abrir `http://localhost:3000/` (puerto según consola del servidor)
3. Esperar carga completa (escuadrón visible, tiles HD alrededor del centro)
4. Pulsar **F** o **Seguir escuadrón** para centrar y fijar zoom táctico
5. Capturar **3 escenas** (PNG sin compresión agresiva):

   - **`baseline-tactical-idle.png`** — escuadrón quieto, terreno explorado visible, fog en bordes
   - **`baseline-tactical-move.png`** — durante movimiento (long-press / orden de marcha), trail de selección visible
   - **`baseline-combat.png`** — combate activo vs bárbaros: trazadores, barras HP, chips de modifiers

6. Guardar en `worldgen/docs/visual-baseline/captures/` (crear la carpeta al capturar; no versionar PNGs grandes salvo acuerdo del equipo)

### Chrome DevTools (móvil)

1. Toggle device toolbar → iPhone 14 Pro o similar
2. Recargar, repetir pasos 3–5
3. Nombre sugerido: `baseline-mobile-tactical-idle.png`

### Comparación pixel a pixel (opcional)

```bash
# ImageMagick — diff rojo sobre cambios
magick compare -metric AE baseline-tactical-idle.png nueva-captura.png diff.png
```

## Checklist de no-regresión (cada fase)

Antes de merge de optimizaciones cliente:

1. **Tiles HD** — ¿128×128 idénticos en viewport (biome + hillshade), filtro LINEAR, sin `pixelArt`?
2. **Unidades** — ¿Legibles con nombre, HP, modifiers/chips y anillos de visión al seleccionar?
3. **FX combate** — ¿Trazadores visibles y desaparecen al terminar (pool ≤ 32 concurrentes)?
4. **Fog** — ¿Explorado permanece legible? ¿Niebla solo en no explorado, sin mancha opaca sobre terreno conocido?
5. **Minimapa** — ¿Celdas exploradas nítidas, overlay de visión y marcador de escuadrón correctos?

## Métricas de apoyo (Fase 0)

Con la consola abierta, cada ~2 s aparece:

```text
[perf] { frameP95Ms, tiles, barbCombatFx, device, memMb }
```

Objetivos orientativos: frame p95 &lt; 16 ms (desktop), &lt; 33 ms (móvil); tiles en RAM acorde al perfil (480 desktop / 120 móvil).

## Script stub

Ver `worldgen/scripts/capture-visual-baseline.mjs` — esqueleto Playwright para automatizar capturas en CI (requiere servidor en marcha y dependencia opcional).
