import { DotType } from "../types";

// Direction encoding: 0=RIGHT 1=DOWN 2=LEFT 3=UP
function edgeDir(fromCr: number, fromCc: number, toCr: number, toCc: number): number {
  if (toCc > fromCc) return 0;
  if (toCr > fromCr) return 1;
  if (toCc < fromCc) return 2;
  return 3;
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
}

// Path for a single isolated cell (no neighbors in any direction)
function singleCellPath(
  r: number,
  c: number,
  dotSize: number,
  xBeginning: number,
  yBeginning: number,
  dotType: DotType
): string {
  const x = xBeginning + c * dotSize;
  const y = yBeginning + r * dotSize;
  const s = dotSize;
  const half = s / 2;
  const cx = x + half;
  const cy = y + half;

  if (dotType === "dots" || dotType === "rounded" || dotType === "extra-rounded") {
    return circlePath(cx, cy, half);
  }

  if (dotType === "classy" || dotType === "classy-rounded") {
    // Two-opposite-corners shape: matches _basicCornersRounded (rotation=PI/2)
    // bottom-left corner rounded, top-right corner rounded
    return (
      `M ${x} ${y}` +
      ` v ${half} a ${half} ${half} 0 0 0 ${half} ${half}` +
      ` h ${half} v ${-half} a ${half} ${half} 0 0 0 ${-half} ${-half}`
    );
  }

  // square: plain rectangle
  return `M ${x} ${y} h ${s} v ${s} h ${-s} Z`;
}

// Emit SVG segment(s) for one corner in the boundary walk.
// prevDir: direction we arrived from; curDir: direction we depart toward.
// turnType === 1 → clockwise/outer convex corner
// turnType === 3 → counter-clockwise/inner concave corner (always sharp)
function cornerSegment(
  cr: number,
  cc: number,
  prevDir: number,
  curDir: number,
  dotSize: number,
  dotType: DotType,
  px: (cc: number) => number,
  py: (cr: number) => number
): string[] {
  const x = px(cc);
  const y = py(cr);
  const turnType = (curDir - prevDir + 4) % 4;

  // Inner concave corner: always a sharp right angle
  if (turnType === 3) return [`L ${x} ${y}`];

  // Outer convex corner — apply dot-type curve
  if (dotType === "square" || dotType === "dots") {
    return [`L ${x} ${y}`];
  }

  if (dotType === "rounded") {
    const r = dotSize / 2;
    // Back up r along incoming direction, then arc r to exit direction.
    // prevDir tells us the direction we came from (= direction of the incoming edge).
    // curDir tells us where we're going next.
    // The corner pixel is at (x, y). The arc entry point is r before the corner
    // along prevDir, and arc exit is r after the corner along curDir.
    const [bx, by] = backupPoint(x, y, prevDir, r);
    const [ex, ey] = exitPoint(x, y, curDir, r);
    return [`L ${bx} ${by}`, `a ${r} ${r} 0 0 1 ${ex - bx} ${ey - by}`];
  }

  if (dotType === "extra-rounded") {
    const r = dotSize;
    const [bx, by] = backupPoint(x, y, prevDir, r);
    const [ex, ey] = exitPoint(x, y, curDir, r);
    return [`L ${bx} ${by}`, `a ${r} ${r} 0 0 1 ${ex - bx} ${ey - by}`];
  }

  if (dotType === "classy" || dotType === "classy-rounded") {
    // classy/classyRounded only cut two specific diagonal corners:
    //   UP→RIGHT (top-left outer corner) and DOWN→LEFT (bottom-right outer corner)
    // All other outer convex corners are sharp.
    const isClassyCut = (prevDir === 3 && curDir === 0) || (prevDir === 1 && curDir === 2);
    if (!isClassyCut) return [`L ${x} ${y}`];

    const r = dotSize / 2;
    const [bx, by] = backupPoint(x, y, prevDir, r);
    const [ex, ey] = exitPoint(x, y, curDir, r);

    if (dotType === "classy") {
      // Straight diagonal cut
      return [`L ${bx} ${by}`, `L ${ex} ${ey}`];
    } else {
      // Quadratic bezier through the corner point
      return [`L ${bx} ${by}`, `Q ${x} ${y} ${ex} ${ey}`];
    }
  }

  return [`L ${x} ${y}`];
}

// Point r units before the corner along the incoming direction
function backupPoint(x: number, y: number, prevDir: number, r: number): [number, number] {
  // prevDir is the direction we were traveling. "back up" = go -prevDir by r.
  switch (prevDir) {
    case 0: return [x - r, y]; // was going RIGHT, back up LEFT
    case 1: return [x, y - r]; // was going DOWN, back up UP
    case 2: return [x + r, y]; // was going LEFT, back up RIGHT
    case 3: return [x, y + r]; // was going UP, back up DOWN
  }
  return [x, y];
}

// Point r units after the corner along the outgoing direction
function exitPoint(x: number, y: number, curDir: number, r: number): [number, number] {
  switch (curDir) {
    case 0: return [x + r, y]; // going RIGHT
    case 1: return [x, y + r]; // going DOWN
    case 2: return [x - r, y]; // going LEFT
    case 3: return [x, y - r]; // going UP
  }
  return [x, y];
}

// Convert an ordered list of boundary corners (corner-space) to an SVG path subpath
function cornersToPath(
  corners: [number, number][],
  dotSize: number,
  xBeginning: number,
  yBeginning: number,
  dotType: DotType
): string {
  const n = corners.length;
  if (n === 0) return "";

  const px = (cc: number) => xBeginning + cc * dotSize;
  const py = (cr: number) => yBeginning + cr * dotSize;

  // Compute edge direction for each step: corners[i] → corners[(i+1)%n]
  const dirs: number[] = corners.map((_, i) => {
    const [cr0, cc0] = corners[i];
    const [cr1, cc1] = corners[(i + 1) % n];
    return edgeDir(cr0, cc0, cr1, cc1);
  });

  // Find a starting index at a real turn (prevDir ≠ curDir)
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    if (dirs[(i - 1 + n) % n] !== dirs[i]) {
      startIdx = i;
      break;
    }
  }

  const segments: string[] = [];
  const [cr0, cc0] = corners[startIdx];
  segments.push(`M ${px(cc0)} ${py(cr0)}`);

  for (let step = 1; step <= n; step++) {
    const i = (startIdx + step) % n;
    const prevDir = dirs[(i - 1 + n) % n];
    const curDir = dirs[i];
    if (prevDir === curDir) continue; // collinear — skip intermediate point
    const [cr, cc] = corners[i];
    segments.push(...cornerSegment(cr, cc, prevDir, curDir, dotSize, dotType, px, py));
  }

  segments.push("Z");
  return segments.join(" ");
}

// Build a single SVG `d` string covering all filled cells produced by isDark.
export function buildDotsPath(
  isDark: (row: number, col: number) => boolean,
  count: number,
  dotSize: number,
  xBeginning: number,
  yBeginning: number,
  dotType: DotType
): string {
  // Build boolean matrix
  const matrix: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    matrix[r] = [];
    for (let c = 0; c < count; c++) {
      matrix[r][c] = isDark(r, c);
    }
  }

  const inBounds = (r: number, c: number) => r >= 0 && r < count && c >= 0 && c < count;
  const key = (r: number, c: number) => `${r},${c}`;

  // dots type: circles never share flat edges, so skip component merging entirely
  if (dotType === "dots") {
    const parts: string[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!matrix[r][c]) continue;
        const cx = xBeginning + c * dotSize + dotSize / 2;
        const cy = yBeginning + r * dotSize + dotSize / 2;
        parts.push(circlePath(cx, cy, dotSize / 2));
      }
    }
    return parts.join(" ");
  }

  // Flood-fill to find connected components (4-connectivity)
  const seen = Array.from({ length: count }, () => new Array(count).fill(false));
  const components: [number, number][][] = [];

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!matrix[r][c] || seen[r][c]) continue;
      const cells: [number, number][] = [];
      const queue: [number, number][] = [[r, c]];
      seen[r][c] = true;
      while (queue.length) {
        const [cr, cc] = queue.shift()!;
        cells.push([cr, cc]);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (inBounds(nr, nc) && matrix[nr][nc] && !seen[nr][nc]) {
            seen[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      components.push(cells);
    }
  }

  const parts: string[] = [];

  for (const cells of components) {
    if (cells.length === 1) {
      const [r, c] = cells[0];
      parts.push(singleCellPath(r, c, dotSize, xBeginning, yBeginning, dotType));
      continue;
    }

    // Multi-cell component: build directed boundary edge map.
    // Diagonal "pinch" corners (two diagonally-adjacent filled cells with neither
    // orthogonal neighbor filled) generate two outgoing edges from the same corner,
    // so we store string[] instead of string to handle that without Map collisions.
    const cellSet = new Set(cells.map(([r, c]) => key(r, c)));
    const inComp = (r: number, c: number) => cellSet.has(key(r, c));
    const edgeMap = new Map<string, string[]>();

    const addEdge = (from: string, to: string) => {
      const arr = edgeMap.get(from);
      if (arr) arr.push(to);
      else edgeMap.set(from, [to]);
    };

    for (const [r, c] of cells) {
      if (!inComp(r - 1, c)) addEdge(key(r,     c),     key(r,     c + 1)); // top    → RIGHT
      if (!inComp(r, c + 1)) addEdge(key(r,     c + 1), key(r + 1, c + 1)); // right  → DOWN
      if (!inComp(r + 1, c)) addEdge(key(r + 1, c + 1), key(r + 1, c));     // bottom → LEFT
      if (!inComp(r, c - 1)) addEdge(key(r + 1, c),     key(r,     c));     // left   → UP
    }

    // Walk all closed cycles. Each directed half-edge "from>to" is walked at most once.
    // At pinch corners (two outgoing edges) we always pick the most-clockwise available
    // turn (right-hand rule), which correctly resolves the crossing.
    const walkedEdges = new Set<string>();
    const edKey = (from: string, to: string) => `${from}>${to}`;

    const pickNext = (ncr: number, ncc: number, inDir: number, candidates: string[]): string => {
      if (candidates.length === 1) return candidates[0];
      return candidates.reduce((best, cand) => {
        const [br, bc] = best.split(",").map(Number);
        const [cr2, cc2] = cand.split(",").map(Number);
        const bestTurn = (edgeDir(ncr, ncc, br, bc) - inDir + 4) % 4;
        const candTurn = (edgeDir(ncr, ncc, cr2, cc2) - inDir + 4) % 4;
        // right-turn(1) > straight(0) > left-turn(3) > U-turn(2)
        const pri = (v: number) => v === 1 ? 0 : v === 0 ? 1 : v === 3 ? 2 : 3;
        return pri(candTurn) < pri(bestTurn) ? cand : best;
      });
    };

    for (const [startCorner, outgoings] of edgeMap) {
      for (const startOut of outgoings) {
        if (walkedEdges.has(edKey(startCorner, startOut))) continue;
        const corners: [number, number][] = [];
        let cur = startCorner;
        let curOut = startOut;

        while (true) {
          const [cr, cc] = cur.split(",").map(Number);
          corners.push([cr, cc]);
          walkedEdges.add(edKey(cur, curOut));
          const [outR, outC] = curOut.split(",").map(Number);
          const inDir = edgeDir(cr, cc, outR, outC);
          cur = curOut;
          if (cur === startCorner) break;
          const [ncr, ncc] = cur.split(",").map(Number);
          const outs = edgeMap.get(cur) ?? [];
          const available = outs.filter(t => !walkedEdges.has(edKey(cur, t)));
          if (available.length === 0) break;
          curOut = pickNext(ncr, ncc, inDir, available);
        }

        parts.push(cornersToPath(corners, dotSize, xBeginning, yBeginning, dotType));
      }
    }
  }

  return parts.join(" ");
}
