/* Pathfinding Web Worker — findPathMacro extracted from viewer/index.html */
'use strict';

const PATH_CELL = 2;
const PATH_CACHE_MAX = 600;
const pathCache = new Map();

let navGrid = null;

function pathCellCost(grid, pc, pr, pathCellSize) {
  let sum = 0, n = 0;
  for (let dr = 0; dr < pathCellSize; dr++) {
    for (let dc = 0; dc < pathCellSize; dc++) {
      const c = pc * pathCellSize + dc, r = pr * pathCellSize + dr;
      if (c >= grid.cols || r >= grid.rows) return Infinity;
      const i = r * grid.cols + c;
      if (grid.blocked[i]) return Infinity;
      sum += grid.moveCost[i]; n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

function isWalkableMacro(x, y) {
  if (!navGrid) return true;
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 0 || row < 0 || col >= navGrid.cols || row >= navGrid.rows) return false;
  return navGrid.blocked[row * navGrid.cols + col] === 0;
}

function nearestWalkable(col, row, maxR = 32) {
  if (!navGrid) return { col, row };
  const { cols, rows, blocked } = navGrid;
  if (col >= 0 && row >= 0 && col < cols && row < rows && !blocked[row * cols + col])
    return { col, row };
  for (let r = 1; r <= maxR; r++) {
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (!blocked[nr * cols + nc]) return { col: nc, row: nr };
      }
    }
  }
  return null;
}

function segmentWalkable(x0, y0, x1, y1) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkableMacro(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

function simplifyPath(path) {
  if (path.length <= 2) return path.slice();
  const out = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!segmentWalkable(path[anchor].x, path[anchor].y, path[i].x, path[i].y)) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

function findPathMacro(fx, fy, tx, ty) {
  if (!navGrid) return [{ x: tx, y: ty }];
  const { cols, rows } = navGrid;
  const pCols = Math.ceil(cols / PATH_CELL);
  const pRows = Math.ceil(rows / PATH_CELL);

  const toPC = (x, y) => ({
    c: Math.max(0, Math.min(pCols - 1, Math.floor(x / PATH_CELL))),
    r: Math.max(0, Math.min(pRows - 1, Math.floor(y / PATH_CELL))),
  });
  const toWorld = (c, r) => ({ x: c * PATH_CELL + PATH_CELL * 0.5, y: r * PATH_CELL + PATH_CELL * 0.5 });

  const pBlocked = (pc, pr) => pathCellCost(navGrid, pc, pr, PATH_CELL) === Infinity;

  let { c: sc, r: sr } = toPC(fx, fy);
  let { c: ec, r: er } = toPC(tx, ty);

  if (pBlocked(ec, er)) {
    const near = nearestWalkable(Math.floor(tx), Math.floor(ty));
    if (!near) return [];
    ({ c: ec, r: er } = toPC(near.col + 0.5, near.row + 0.5));
  }
  if (pBlocked(sc, sr)) return [];

  const cacheKey = `${sc},${sr}:${ec},${er}`;
  if (pathCache.has(cacheKey)) {
    const cached = pathCache.get(cacheKey).map(p => ({ x: p.x, y: p.y }));
    if (cached.length) cached[cached.length - 1] = { x: tx, y: ty };
    return cached;
  }

  const start = sr * pCols + sc;
  const goal  = er * pCols + ec;
  if (start === goal) return [{ x: tx, y: ty }];

  const N = pCols * pRows;
  const gScore = new Float32Array(N); gScore.fill(Infinity);
  const fScore = new Float32Array(N); fScore.fill(Infinity);
  const cameFrom = new Int32Array(N); cameFrom.fill(-1);
  const inOpen = new Uint8Array(N);
  const open = [start];
  inOpen[start] = 1;
  gScore[start] = 0;
  fScore[start] = Math.hypot(ec - sc, er - sr);

  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false;
  for (let iter = 0; iter < 40000 && open.length; iter++) {
    let bestI = 0;
    for (let i = 1; i < open.length; i++)
      if (fScore[open[i]] < fScore[open[bestI]]) bestI = i;
    const current = open[bestI];
    open[bestI] = open[open.length - 1];
    open.pop();
    inOpen[current] = 0;
    if (current === goal) { found = true; break; }

    const cc = current % pCols, cr = (current / pCols) | 0;
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= pCols || nr >= pRows) continue;
      if (pBlocked(nc, nr)) continue;
      const ni = nr * pCols + nc;
      const cellCost = pathCellCost(navGrid, nc, nr, PATH_CELL);
      const step = (dc && dr ? 1.414 : 1) * cellCost;
      const tg = gScore[current] + step;
      if (tg >= gScore[ni]) continue;
      cameFrom[ni] = current;
      gScore[ni] = tg;
      fScore[ni] = tg + Math.hypot(ec - nc, er - nr);
      if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
    }
  }
  if (!found) return [];

  const raw = [];
  let cur = goal;
  while (cur !== -1) {
    const c = cur % pCols, r = (cur / pCols) | 0;
    raw.push(toWorld(c, r));
    if (cur === start) break;
    cur = cameFrom[cur];
  }
  raw.reverse();
  raw[0] = { x: fx, y: fy };
  raw[raw.length - 1] = { x: tx, y: ty };
  const simplified = simplifyPath(raw);
  const result = simplified.length > 1 ? simplified.slice(1) : [{ x: tx, y: ty }];

  if (pathCache.size >= PATH_CACHE_MAX) pathCache.delete(pathCache.keys().next().value);
  pathCache.set(cacheKey, result.map(p => ({ x: p.x, y: p.y })));

  return result;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    navGrid = {
      cols: msg.cols,
      rows: msg.rows,
      blocked: new Uint8Array(msg.blocked),
      moveCost: new Float32Array(msg.moveCost),
    };
    pathCache.clear();
    return;
  }
  if (msg.type === 'findPath') {
    const path = findPathMacro(msg.fx, msg.fy, msg.tx, msg.ty);
    self.postMessage({ type: 'pathResult', id: msg.id, path });
  }
};
