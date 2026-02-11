import * as dat from "dat.gui";

type Point = [number, number];
type FullSphereMode = "single" | "side-by-side" | "flower";

interface ControlsState {
  diameter: number;
  gores: number;
  fullSphere: FullSphereMode;
  scaleXMm: number;
  scaleYMm: number;
  latMax: number;
  samples: number;
}

interface BuildResult {
  svg: string;
  width: number;
  height: number;
  layoutCount: number;
}

const DEFAULT_FILL = "#000000";
const DEFAULT_FILL_OPACITY = 0.5;
const DEFAULT_STROKE = "none";
const DEFAULT_STROKE_WIDTH_MM = 0;
const PI = Math.PI;
const STORAGE_KEY = "lune-gore-svg-generator:v1";

const defaults: ControlsState = {
  diameter: 200,
  gores: 12,
  fullSphere: "single",
  scaleXMm: 0,
  scaleYMm: 0,
  latMax: 90,
  samples: 24,
};

const state: ControlsState = { ...defaults, ...loadStateFromStorage() };
const previewEl = document.getElementById("preview");
const metaEl = document.getElementById("meta");

if (!previewEl || !metaEl) {
  throw new Error("Required DOM nodes not found.");
}

let currentSvg = "";
let currentFilename = "lune.svg";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function loadStateFromStorage(): Partial<ControlsState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<Record<keyof ControlsState, unknown>>;
    const mode = parsed.fullSphere;
    const fullSphere: FullSphereMode =
      mode === "single" || mode === "side-by-side" || mode === "flower" ? mode : defaults.fullSphere;

    return {
      diameter: clampNumber(parsed.diameter, 1, 2000, defaults.diameter),
      gores: Math.round(clampNumber(parsed.gores, 1, 64, defaults.gores)),
      fullSphere,
      scaleXMm: clampNumber(parsed.scaleXMm, -50, 50, defaults.scaleXMm),
      scaleYMm: clampNumber(parsed.scaleYMm, -50, 50, defaults.scaleYMm),
      latMax: clampNumber(parsed.latMax, 0, 90, defaults.latMax),
      samples: Math.round(clampNumber(parsed.samples, 1, 240, defaults.samples)),
    };
  } catch {
    return {};
  }
}

function saveStateToStorage(cfg: ControlsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage failures (private mode, quota, disabled storage, etc.)
  }
}

function setControllerHint(controller: dat.GUIController, hint: string): void {
  controller.domElement.title = hint;

  const textNodes = controller.domElement.querySelectorAll(".property-name, input, select, button");
  for (const node of textNodes) {
    if (node instanceof HTMLElement) {
      node.title = hint;
    }
  }
}

function sanitizeToken(text: string): string {
  const cleaned = text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return cleaned || "x";
}

function formatValueForFilename(value: number | string): string {
  if (typeof value === "number") {
    return sanitizeToken(`${value}`.replace(/-/g, "m").replace(/\./g, "p"));
  }
  return sanitizeToken(value);
}

function autoFilename(cfg: ControlsState): string {
  const parts = ["lune"];
  const entries: [keyof ControlsState, number | string][] = [
    ["diameter", cfg.diameter],
    ["gores", cfg.gores],
    ["fullSphere", cfg.fullSphere],
    ["scaleXMm", cfg.scaleXMm],
    ["scaleYMm", cfg.scaleYMm],
    ["latMax", cfg.latMax],
    ["samples", cfg.samples],
  ];

  for (const [key, value] of entries) {
    if (value === defaults[key]) {
      continue;
    }
    parts.push(`${sanitizeToken(key)}-${formatValueForFilename(value)}`);
  }
  return `${parts.join("_")}.svg`;
}

function maxCosOnInterval(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const twoPi = 2 * PI;
  const k = Math.ceil(lo / twoPi);
  if (k * twoPi <= hi) {
    return 1;
  }
  return Math.max(Math.cos(lo), Math.cos(hi));
}

function goreBounds(radius: number, gores: number, latMin: number, latMax: number): [number, number, number, number] {
  if (gores < 1) {
    throw new Error("gores must be >= 1");
  }
  if (radius <= 0) {
    throw new Error("diameter must be > 0");
  }
  if (latMin >= latMax) {
    throw new Error("lat range invalid: lat_min must be < lat_max");
  }

  const deltaLambda = (2 * PI) / gores;
  const amp = 0.5 * radius * deltaLambda;
  const maxHalfWidth = Math.max(0, amp * maxCosOnInterval(latMin, latMax));
  return [-maxHalfWidth, radius * latMin, maxHalfWidth, radius * latMax];
}

function halfWidthAtLat(radius: number, deltaLambda: number, lat: number): number {
  const halfWidth = 0.5 * radius * deltaLambda * Math.cos(lat);
  return halfWidth > 0 ? halfWidth : 0;
}

function scaleFactorsFromDeltas(
  baseWidth: number,
  baseHeight: number,
  scaleXMm: number,
  scaleYMm: number,
): [number, number] {
  const targetWidth = baseWidth + scaleXMm;
  const targetHeight = baseHeight + scaleYMm;
  if (targetWidth <= 0) {
    throw new Error("--scale-x-mm makes peel width <= 0");
  }
  if (targetHeight <= 0) {
    throw new Error("--scale-y-mm makes peel height <= 0");
  }
  return [targetWidth / baseWidth, targetHeight / baseHeight];
}

function transformPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Point {
  return [cx + (x - cx) * sx + tx, cy + (y - cy) * sy + ty];
}

function rotatePoint(x: number, y: number, pivotX: number, pivotY: number, angleRad: number): Point {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const dx = x - pivotX;
  const dy = y - pivotY;
  return [pivotX + dx * cosA - dy * sinA, pivotY + dx * sinA + dy * cosA];
}

function gorePolygonPoints(
  radius: number,
  gores: number,
  latMin: number,
  latMax: number,
  segments: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
): Point[] {
  if (segments < 1) {
    throw new Error("samples must be >= 1");
  }

  const deltaLambda = (2 * PI) / gores;
  const dLat = (latMax - latMin) / segments;
  const yTop = radius * latMin;
  const yBottom = radius * latMax;
  const xTop = halfWidthAtLat(radius, deltaLambda, latMin);
  const xBottom = halfWidthAtLat(radius, deltaLambda, latMax);
  const points: Point[] = [];

  points.push(transformPoint(-xTop, yTop, cx, cy, sx, sy, 0, 0));
  if (xTop > 1e-12) {
    points.push(transformPoint(xTop, yTop, cx, cy, sx, sy, 0, 0));
  }

  for (let i = 0; i < segments; i += 1) {
    const lat = latMin + dLat * (i + 1);
    const x = halfWidthAtLat(radius, deltaLambda, lat);
    const y = radius * lat;
    points.push(transformPoint(x, y, cx, cy, sx, sy, 0, 0));
  }

  if (xBottom > 1e-12) {
    points.push(transformPoint(-xBottom, yBottom, cx, cy, sx, sy, 0, 0));
  }

  for (let i = 0; i < segments; i += 1) {
    const lat = latMax - dLat * (i + 1);
    const x = -halfWidthAtLat(radius, deltaLambda, lat);
    const y = radius * lat;
    points.push(transformPoint(x, y, cx, cy, sx, sy, 0, 0));
  }
  return points;
}

function polygonToPath(points: Point[]): string {
  if (points.length === 0) {
    throw new Error("polygon must contain at least one point");
  }
  const cmds = [`M ${points[0][0].toFixed(6)} ${points[0][1].toFixed(6)}`];
  for (let i = 1; i < points.length; i += 1) {
    cmds.push(`L ${points[i][0].toFixed(6)} ${points[i][1].toFixed(6)}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
}

function buildSvg(cfg: ControlsState): BuildResult {
  const gores = Math.max(1, Math.round(cfg.gores));
  const samples = Math.max(1, Math.round(cfg.samples));
  const latMaxDeg = Math.min(90, Math.max(0, cfg.latMax));
  const radius = cfg.diameter * 0.5;
  const latMin = (-90 * PI) / 180;
  const latMax = (latMaxDeg * PI) / 180;
  const [minX, minY, maxX, maxY] = goreBounds(radius, gores, latMin, latMax);
  const baseWidth = maxX - minX;
  const baseHeight = maxY - minY;
  const [sx, sy] = scaleFactorsFromDeltas(baseWidth, baseHeight, cfg.scaleXMm, cfg.scaleYMm);
  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);

  const basePoints = gorePolygonPoints(radius, gores, latMin, latMax, samples, cx, cy, sx, sy);
  const polygons: Point[][] = [];

  if (cfg.fullSphere === "side-by-side") {
    for (let i = 0; i < gores; i += 1) {
      const ox = i * baseWidth;
      polygons.push(basePoints.map(([x, y]) => [x + ox, y]));
    }
  } else if (cfg.fullSphere === "flower") {
    const yTop = radius * latMin;
    const yBottom = radius * latMax;
    const [pivotX, pivotY] = transformPoint(0, yTop, cx, cy, sx, 1, 0, 0);
    const [outerBaseX, outerBaseY] = transformPoint(0, yBottom, cx, cy, sx, 1, 0, 0);
    const [outerScaledX, outerScaledY] = transformPoint(0, yBottom, cx, cy, sx, sy, 0, 0);
    const baseRadius = Math.hypot(outerBaseX - pivotX, outerBaseY - pivotY);
    const scaledRadius = Math.hypot(outerScaledX - pivotX, outerScaledY - pivotY);
    const insetRadius = scaledRadius - baseRadius;
    const angleStep = (2 * PI) / gores;

    for (let i = 0; i < gores; i += 1) {
      const angle = i * angleStep;
      let rotated = basePoints.map(([x, y]) => rotatePoint(x, y, pivotX, pivotY, angle));

      if (Math.abs(insetRadius) > 1e-12) {
        const [outerRotX, outerRotY] = rotatePoint(outerScaledX, outerScaledY, pivotX, pivotY, angle);
        const dirX = outerRotX - pivotX;
        const dirY = outerRotY - pivotY;
        const norm = Math.hypot(dirX, dirY);
        if (norm > 1e-12) {
          const shiftX = -insetRadius * (dirX / norm);
          const shiftY = -insetRadius * (dirY / norm);
          rotated = rotated.map(([x, y]) => [x + shiftX, y + shiftY]);
        }
      }
      polygons.push(rotated);
    }
  } else {
    polygons.push(basePoints);
  }

  const allPoints = polygons.flat();
  const globalMinX = Math.min(...allPoints.map(([x]) => x));
  const globalMaxX = Math.max(...allPoints.map(([x]) => x));
  const globalMinY = Math.min(...allPoints.map(([, y]) => y));
  const globalMaxY = Math.max(...allPoints.map(([, y]) => y));
  const width = globalMaxX - globalMinX;
  const height = globalMaxY - globalMinY;

  const paths = polygons
    .map((poly) => poly.map(([x, y]) => [x - globalMinX, y - globalMinY] as Point))
    .map((poly) => polygonToPath(poly))
    .map(
      (d) =>
        `<path d="${d}" fill="${DEFAULT_FILL}" fill-opacity="${DEFAULT_FILL_OPACITY.toFixed(3)}" ` +
        `stroke="${DEFAULT_STROKE}" stroke-width="${DEFAULT_STROKE_WIDTH_MM.toFixed(6)}" />`,
    )
    .join("\n");

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(6)}mm" height="${height.toFixed(
      6,
    )}mm" viewBox="0 0 ${width.toFixed(6)} ${height.toFixed(6)}">\n` +
    `${paths}\n` +
    `</svg>\n`;

  return {
    svg,
    width,
    height,
    layoutCount: polygons.length,
  };
}

function triggerDownload(filename: string, data: string): void {
  const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function render(): void {
  try {
    const normalized: ControlsState = {
      ...state,
      diameter: Number(state.diameter),
      gores: Math.max(1, Math.round(Number(state.gores))),
      scaleXMm: Number(state.scaleXMm),
      scaleYMm: Number(state.scaleYMm),
      latMax: Math.max(0, Math.min(90, Number(state.latMax))),
      samples: Math.max(1, Math.round(Number(state.samples))),
    };

    const result = buildSvg(normalized);
    saveStateToStorage(normalized);
    currentSvg = result.svg;
    currentFilename = autoFilename(normalized);
    const svgMarkup = result.svg.replace(/^<\?xml.*?\?>\s*/u, "");
    previewEl.innerHTML = svgMarkup;
    metaEl.textContent = `Canvas: ${result.width.toFixed(3)} x ${result.height.toFixed(3)} mm | Pieces: ${
      result.layoutCount
    }`;
  } catch (error) {
    previewEl.innerHTML = "";
    metaEl.textContent = error instanceof Error ? error.message : "Render error";
  }
}

const gui = new dat.GUI({ name: "Lune Gore Controls", width: 340 });
const diameterController = gui.add(state, "diameter", 1, 2000, 0.1).name("diameter (mm)").onChange(render);
setControllerHint(
  diameterController,
  "Sphere diameter in millimeters. This sets the physical size of each generated gore in the exported SVG.",
);

const goresController = gui.add(state, "gores", 1, 64, 1).name("gores").onChange(render);
setControllerHint(
  goresController,
  "Number of gores needed to cover the sphere. Higher values produce narrower individual gores.",
);

const fullSphereController = gui
  .add(state, "fullSphere", {
    single: "single",
    "side-by-side": "side-by-side",
    flower: "flower",
  })
  .name("full-sphere")
  .onChange(render);
setControllerHint(
  fullSphereController,
  "Layout mode: single = one gore, side-by-side = all gores in a strip, flower = radial petals touching at one point.",
);

const scaleXController = gui.add(state, "scaleXMm", -50, 50, 0.1).name("scale-x-mm").onChange(render);
setControllerHint(
  scaleXController,
  "Adds width per gore in millimeters after projection. Use small values for fit compensation.",
);

const scaleYController = gui.add(state, "scaleYMm", -50, 50, 0.1).name("scale-y-mm").onChange(render);
setControllerHint(
  scaleYController,
  "Adds height per gore in millimeters. In flower mode, petals are shifted so the outer reference circle remains stable.",
);

const latMaxController = gui.add(state, "latMax", 0, 90, 1).name("lat-max").onChange(render);
setControllerHint(
  latMaxController,
  "Upper latitude limit in degrees. Effective range is from -90 to +lat-max.",
);

const samplesController = gui.add(state, "samples", 1, 240, 1).name("samples").onChange(render);
setControllerHint(
  samplesController,
  "Curve resolution (segments per edge). Higher values make smoother outlines but larger SVG paths.",
);

const actions = {
  downloadSvg: (): void => {
    if (currentSvg.length > 0) {
      triggerDownload(currentFilename, currentSvg);
    }
  },
};
const downloadController = gui.add(actions, "downloadSvg").name("Download SVG");
setControllerHint(
  downloadController,
  "Downloads the currently displayed SVG using current parameters and physical mm dimensions.",
);

render();
