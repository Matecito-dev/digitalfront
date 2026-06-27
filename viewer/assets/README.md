# Assets del viewer (imágenes)

Imágenes de marca y fondo del overlay de login (`viewer/index.html`).

| Archivo | Uso | Dimensiones | Notas |
|---------|-----|-------------|--------|
| `dglogo.webp` / `dglogo.png` | Logo en login | 256×256 | `<picture>` prefiere WebP |
| `dgbanner.webp` / `dgbanner.png` | Banner bajo el logo | 1200×400 | Redimensionado desde 2172×724 |
| `dgbg.webp` / `dgbg.jpg` | Fondo del overlay | 1672×941 | `image-set` WebP + JPG en CSS |
| `menu-bg.jpg` | Fallback de fondo (opcional) | — | Si falta, se usa solo `dgbg.*` |

Origen (27 jun 2026): `/home/sexs/Descargas/DGlogo.png`, `DGBanner.png`, `DGBG.png` — optimizados con ImageMagick.

## Audio (carpeta `viewer/audio/`)

| Archivo | Uso |
|---------|-----|
| `menu-bgm.mp3` | Música de login / menú (`backround.mp3` en Descargas) |
| `shot.mp3` | Disparos (`rifle.mp3` en Descargas) |
| `impact.mp3` | Impactos (opcional; no encontrado en Descargas) |

Si faltan MP3, el juego usa síntesis Web Audio (`sfx.js`, `bgm.js`).

## Tamaños finales (aprox.)

```
dglogo.png      58K   dglogo.webp     7.2K
dgbanner.png   660K   dgbanner.webp    61K
dgbg.jpg       207K   dgbg.webp       115K
menu-bgm.mp3   198K   shot.mp3         69K
```

Los bundles `scripts/bundle-vercel.mjs` y `scripts/bundle-viewer-www.mjs` copian `viewer/assets/` y `viewer/audio/` completos; no hace falta listar archivos uno a uno.
