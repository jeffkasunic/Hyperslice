// App state, UI, rendering, and input.
import "./styles.css";
import { dot, planes, slice, type Angles, type Slice, type Vector } from "./geometry";
import { shapeName } from "./shapes";
import { initPrimer } from "./primer";

interface Camera {
  yaw: number;
  pitch: number;
}
interface View {
  zoom: number;
  hiddenEdges: boolean;
  spin: boolean;
  sweep: boolean;
}
interface State extends Camera, View {
  angles: Angles;
  offset: number;
}
type ToggleKey = "hiddenEdges" | "spin" | "sweep";
type Counts = [vertices: number, edges: number, faces: number];

// Each sample is a tesseract orientation plus the slice position that cuts it.
const faceFirst = [45, 0, 0, 0, 0, 0];
const edgeFirst = [45, 35, 0, 0, 0, 0];
const vertexFirst = [45, Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI, 30, 0, 0, 0];
const samples: Partial<Record<string, { angles: readonly number[]; offset: number }>> = {
  cube: { angles: [0, 0, 0, 0, 0, 0], offset: 0 },
  box: { angles: faceFirst, offset: 0 },
  "triangular-prism": { angles: edgeFirst, offset: 1 },
  "pentagonal-prism": { angles: [30, 30, 0, 0, 0, 0], offset: 0.4 },
  prism: { angles: edgeFirst, offset: 0 },
  tetrahedron: { angles: vertexFirst, offset: 1.5 },
  "truncated-tetrahedron": { angles: vertexFirst, offset: 0.5 },
  octahedron: { angles: vertexFirst, offset: 0 },
};

const introAngles = [32, -25, 19, 0, 0, 0];
const defaultCamera: Camera = { yaw: -0.52, pitch: 0.39 };
const defaultView: View = { zoom: 1, hiddenEdges: true, spin: false, sweep: false };
const zoomLimits = [0.5, 3] as const;
const state: State = {
  angles: [...introAngles],
  offset: 0.35,
  ...defaultCamera,
  ...defaultView,
};

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error("Missing element: " + what);
  return value;
}
function byId<T extends Element = HTMLElement>(id: string): T {
  return required(document.getElementById(id), "#" + id) as Element as T;
}

const svg = byId<SVGSVGElement>("view");
const stage = byId("stage");
const depth = byId<HTMLInputElement>("depth");
const depthValue = byId<HTMLInputElement>("depth-value");
const presets = [...document.querySelectorAll<HTMLButtonElement>("[data-preset]")];
const spatialDetails = required(document.querySelector("details"), "details");
const stats = [byId("vertices"), byId("edges"), byId("faces")];
const scene = { width: 0, height: 0, frame: 0 };
const toggles: Record<ToggleKey, HTMLButtonElement> = {
  hiddenEdges: byId("toggle-hidden"),
  spin: byId("toggle-spin"),
  sweep: byId("toggle-sweep"),
};
const toggleKeys = Object.keys(toggles) as ToggleKey[];
let geometry: Slice | undefined;

const signed = (number: number, digits: number): string => {
  const rounded = Number(number.toFixed(digits));
  const magnitude = Math.abs(rounded).toFixed(digits);
  return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + magnitude;
};
const degrees = (value: number): string =>
  signed(value, Number(value.toFixed(1)) === Number(value.toFixed(2)) ? 1 : 2).replace(/\.0$/, "") + "°";

const rotationInputs = planes.map(({ name, label }, index) => {
  const target = byId(index < 3 ? "w-planes" : "spatial-planes");
  const row = document.createElement("div");
  row.innerHTML = `
    <div class="plane-label">
      <label for="plane-${name}"><strong>${name}</strong> ${label}</label>
      <input type="text" class="readout" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${name} angle in degrees">
    </div>
    <input type="range" id="plane-${name}" min="-180" max="180" step="0.1">
  `;
  target.append(row);
  const input = required(row.querySelector<HTMLInputElement>("input[type=range]"), "plane input");
  const field = required(row.querySelector<HTMLInputElement>(".readout"), "plane readout");
  input.addEventListener("input", () => {
    state.angles[index] = input.valueAsNumber;
    update();
  });
  bindReadout(field, () => degrees(state.angles[index]), value => {
    // Typed angles wrap around the circle rather than clamping.
    state.angles[index] = value >= -180 && value <= 180 ? value : ((value + 180) % 360 + 360) % 360 - 180;
    update();
  });
  return { input, field };
});

// Readouts double as text fields: Enter or leaving the field applies, Escape reverts.
function bindReadout(field: HTMLInputElement, format: () => string, apply: (value: number) => void): void {
  const commit = () => {
    const value = Number(field.value.trim().replace(/^W\s*=\s*/i, "").replace(/[−–]/g, "-").replace(/°$/, ""));
    if (field.value.trim() !== "" && Number.isFinite(value)) apply(Math.round(value * 100) / 100);
    field.value = format();
  };
  field.addEventListener("change", commit);
  field.addEventListener("focus", () => field.select());
  field.addEventListener("keydown", event => {
    if (event.key === "Enter") { commit(); field.select(); }
    else if (event.key === "Escape") { field.value = format(); field.select(); }
  });
}

function setReadout(field: HTMLInputElement, text: string): void {
  if (document.activeElement !== field) field.value = text;
}

function rangePosition(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.style.setProperty("--position", (value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100 + "%");
}

function update(): void {
  const current = geometry = slice(state.angles, state.offset);
  const preset = Object.entries(samples).find(([, sample]) =>
    sample && state.offset === sample.offset && sample.angles.every((angle, index) => angle === state.angles[index])
  )?.[0];
  for (const button of presets) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }

  rotationInputs.forEach(({ input, field }, index) => {
    const value = state.angles[index];
    rangePosition(input, value);
    setReadout(field, degrees(value));
    input.setAttribute("aria-valuetext", degrees(value));
  });
  const offset = signed(state.offset, 2);
  rangePosition(depth, state.offset);
  depth.setAttribute("aria-valuetext", offset);
  setReadout(depthValue, offset);
  byId("slice-badge").textContent = "W = " + offset;
  byId("depth-hint").textContent = "Intersects from " + signed(-current.extent, 2) + " to " + signed(current.extent, 2) + ".";
  const active = planes.filter((_, index) => Math.abs(state.angles[index]) > 1e-8).map(plane => plane.name);
  byId("active").textContent = "Active planes · " + (active.length ? active.join(" / ") : "None");

  const counts: Counts = [current.points.length, current.edgeCount, current.faces.length];
  stats.forEach((element, index) => { element.textContent = String(counts[index]); });
  const name = shapeName(current);
  byId("slice-title").textContent = name;
  byId("empty").hidden = counts[0] > 0;
  describeSlice(name, counts);
  scheduleDraw();
}

// Screen readers hear one sentence once the slice settles, not every slider tick.
const announcer = byId("slice-announcer");
const viewTitle = byId<SVGTitleElement>("view-title");
const announceDelay = 500;
let announceTimer = 0;
let announced: string | undefined;
const plural = (count: number, one: string, many: string): string => count + " " + (count === 1 ? one : many);

function describeSlice(name: string, [vertexCount, edgeCount, faceCount]: Counts): void {
  const summary = vertexCount === 0
    ? "Empty slice. The plane misses the tesseract."
    : `${name}. ${plural(vertexCount, "vertex", "vertices")}, ${plural(edgeCount, "edge", "edges")}, ${plural(faceCount, "face", "faces")}.`;
  viewTitle.textContent = "Interactive 3D view of the tesseract cross-section: " + summary;
  if (announced === undefined) {
    announced = summary; // Don't speak on page load.
    return;
  }
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    if (summary === announced) return;
    announced = summary;
    announcer.textContent = summary;
  }, announceDelay);
}

function scheduleDraw(): void {
  if (scene.frame) return;
  scene.frame = requestAnimationFrame(() => {
    scene.frame = 0;
    draw();
  });
}

/** Rotates a slice-space point into camera space: x right, y up, z toward the viewer. */
function cameraTransform(): (point: Vector) => Vector {
  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
  const sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);
  return ([x, y, z]) => {
    const depth = sy * x + cy * z;
    return [cy * x - sy * z, cp * y - sp * depth, sp * y + cp * depth];
  };
}

function svgPoint(point: Vector): string {
  return point.slice(0, 2).map(value => value.toFixed(1)).join(",");
}

function draw(): void {
  const { width, height } = scene;
  if (!geometry || !width || !height) return;
  const orient = cameraTransform();
  const scale = Math.min(width, height) * 0.232 * state.zoom;
  const project = (point: Vector): Vector => {
    const [x, y, z] = orient(point);
    return [width * 0.5 + x * scale, height * 0.505 - y * scale, z];
  };

  const grid: string[] = [];
  for (let index = -6; index <= 6; index++) {
    const position = index * 0.42;
    const floor = -1.62;
    const span = 3.3;
    const rows = [[[-span, floor, position], [span, floor, position]], [[position, floor, -span], [position, floor, span]]];
    for (const row of rows) {
      grid.push(`<path d="M${svgPoint(project(row[0]))}L${svgPoint(project(row[1]))}" opacity="${index === 0 ? 0.47 : 0.29}"/>`);
    }
  }
  byId("grid").innerHTML = `<g stroke="#7a7269" stroke-width="1" fill="none">${grid.join("")}</g>`;

  const points = geometry.points.map(project);
  const front = new Set<number>();
  const light = [-0.28, 0.67, 0.69];
  const hue = 28;
  const fragments: string[] = [];
  const faceLayers = geometry.faces.map(({ indices, normal }) => ({
    indices,
    normal: orient(normal),
    depth: indices.reduce((sum, index) => sum + points[index][2], 0) / indices.length,
  })).sort((a, b) => a.depth - b.depth);

  const outline = "#e9a970";
  // Edge key -> endpoints, and whether any face touching it faces the camera.
  const edgeVisibility = new Map<string, { a: number; b: number; visible: boolean }>();
  for (const { indices, normal } of faceLayers) {
    const facing = geometry.dimension < 3 || normal[2] >= -1e-6;
    indices.forEach((a, i) => {
      const b = indices[(i + 1) % indices.length];
      const key = a < b ? a + "," + b : b + "," + a;
      const edge = edgeVisibility.get(key) ?? { a, b, visible: false };
      edge.visible ||= facing;
      edgeVisibility.set(key, edge);
    });
    if (!facing) continue;
    indices.forEach(index => front.add(index));
    const shade = 27 + Math.max(0, dot(normal, light)) * 25;
    fragments.push(`<polygon points="${indices.map(index => svgPoint(points[index])).join(" ")}" fill="hsl(${hue + normal[0] * 8} 42% ${shade}%)" stroke="${outline}" stroke-width="1.65" stroke-linejoin="round"/>`);
  }
  // Back edges go on top of the faces, dashed, the way technical drawings show them.
  if (state.hiddenEdges && geometry.dimension === 3) {
    const hidden = [...edgeVisibility.values()].filter(edge => !edge.visible)
      .map(({ a, b }) => `M${svgPoint(points[a])}L${svgPoint(points[b])}`);
    fragments.push(`<path d="${hidden.join("")}" fill="none" stroke="${outline}" stroke-width="1.15" stroke-dasharray="3 4" stroke-linecap="round" opacity="0.5"/>`);
    points.forEach(([x, y], index) => {
      if (!front.has(index)) fragments.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.9" fill="${outline}" opacity="0.5"/>`);
    });
  }
  if (geometry.dimension === 1) {
    fragments.push(`<polyline points="${points.map(svgPoint).join(" ")}" fill="none" stroke="${outline}" stroke-width="2"/>`);
  }
  if (geometry.dimension < 2) points.forEach((_, index) => front.add(index));
  for (const index of front) {
    const [x, y] = points[index];
    fragments.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.65" fill="#f3d1b3"/>`);
  }
  byId("shape").innerHTML = fragments.join("");

  const axisColors = ["#d67060", "#e8b64e", "#6ebede"];
  const axes = ["X", "Y", "Z"].map((label, index) => {
    const [x, y, z] = orient([0, 1, 2].map(axis => Number(axis === index)));
    const end = [27 + 19 * x, 32 - 19 * y];
    const text = [27 + 26 * x, 34 - 26 * y];
    return { label, color: axisColors[index], end, text, z };
  }).sort((a, b) => a.z - b.z);
  byId("axis").innerHTML = `<svg width="60" height="60" viewBox="0 0 60 60">${axes.map(({ label, color, end, text }) =>
    `<path d="M27,32L${svgPoint(end)}" stroke="${color}" stroke-width="1.3"/><text x="${text[0]}" y="${text[1]}" fill="${color}" text-anchor="middle" font-size="9" font-family="monospace">${label}</text>`
  ).join("")}<circle cx="27" cy="32" r="2" fill="#e3dcd1"/></svg>`;
}

// Any direct change to the slice position takes over from the W sweep.
function setView(changes: Partial<View>): void {
  Object.assign(state, changes);
  for (const key of toggleKeys) toggles[key].setAttribute("aria-pressed", String(state[key]));
  animate();
  scheduleDraw();
}

depth.addEventListener("input", () => {
  state.offset = depth.valueAsNumber;
  setView({ sweep: false });
  update();
});
bindReadout(depthValue, () => signed(state.offset, 2), value => {
  state.offset = Math.min(Number(depth.max), Math.max(Number(depth.min), value));
  setView({ sweep: false });
  update();
});
for (const button of presets) {
  button.addEventListener("click", () => {
    const sample = samples[button.dataset.preset ?? ""];
    if (!sample) return;
    state.angles = [...sample.angles];
    state.offset = sample.offset;
    setView({ sweep: false });
    update();
  });
}
byId("reset").addEventListener("click", () => {
  Object.assign(state, { angles: [...introAngles], offset: 0.35, ...defaultCamera });
  setView(defaultView);
  spatialDetails.open = false;
  update();
});
for (const key of toggleKeys) {
  toggles[key].addEventListener("click", () => setView({ [key]: !state[key] }));
}

// One animation loop drives both auto-rotate and the W sweep, and stops when neither is on.
const spinSpeed = 0.35; // radians of yaw per second
const sweepSpeed = 0.4; // W units per second
const animation = { frame: 0, last: 0, direction: 1 };
function animate(): void {
  if (!(state.spin || state.sweep)) {
    cancelAnimationFrame(animation.frame);
    animation.frame = 0;
    return;
  }
  if (animation.frame) return;
  animation.last = performance.now();
  animation.frame = requestAnimationFrame(tick);
}
function tick(now: number): void {
  const seconds = Math.min(0.05, (now - animation.last) / 1000);
  animation.last = now;
  if (state.spin && pointers.size === 0) {
    state.yaw += spinSpeed * seconds;
    scheduleDraw();
  }
  if (state.sweep && geometry) {
    const limit = Math.min(Number(depth.max), geometry.extent);
    let offset = state.offset + animation.direction * sweepSpeed * seconds;
    if (Math.abs(offset) >= limit) {
      offset = Math.sign(offset) * limit;
      animation.direction = -Math.sign(offset);
    }
    state.offset = offset;
    update();
  }
  animation.frame = requestAnimationFrame(tick);
}

function orbit(deltaX: number, deltaY: number): void {
  state.yaw += deltaX;
  state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch + deltaY));
  scheduleDraw();
}
function zoomBy(factor: number): void {
  state.zoom = Math.max(zoomLimits[0], Math.min(zoomLimits[1], state.zoom * factor));
  scheduleDraw();
}

// One pointer orbits; two pointers pinch-zoom.
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number } | undefined;
const pinchDistance = (): number => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
svg.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  svg.setPointerCapture(event.pointerId);
  if (pointers.size === 2) pinch = { distance: pinchDistance(), zoom: state.zoom };
});
svg.addEventListener("pointermove", event => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  if (pointers.size === 1) orbit((event.clientX - pointer.x) * 0.009, (event.clientY - pointer.y) * 0.009);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (pinch && pointers.size === 2) zoomBy(pinch.zoom * pinchDistance() / Math.max(1, pinch.distance) / state.zoom);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
  svg.addEventListener(type, event => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = undefined;
  });
}
svg.addEventListener("wheel", event => {
  event.preventDefault();
  const lines = event.deltaMode === 1 ? 16 : 1;
  // Trackpad pinches arrive as ctrl+wheel with small deltas.
  zoomBy(Math.exp(-event.deltaY * lines * (event.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
const orbitKeys: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0],
  ArrowUp: [0, -0.12], ArrowDown: [0, 0.12],
};
const zoomKeys: Partial<Record<string, number>> = { "+": 1.15, "=": 1.15, "-": 1 / 1.15, "_": 1 / 1.15 };
// Full screen uses the Fullscreen API where the browser allows it on an element
// (not iPhone Safari); otherwise the viewer is stretched over the page with CSS.
const viewport = required(stage.closest<HTMLElement>(".viewport"), ".viewport");
const fullscreenButton = byId<HTMLButtonElement>("fullscreen");
const isFullscreen = () => document.fullscreenElement === viewport || viewport.classList.contains("expanded");
// In full screen the whole control panel moves into a dock beside the view,
// then returns to the page on exit.
const dock = byId("dock");
const controlsPanel = required(document.querySelector<HTMLElement>(".controls"), ".controls");
const dockedGroups = [...controlsPanel.children].map(group => {
  const home = document.createComment("docked control");
  group.before(home);
  return { group, home };
});
function syncFullscreen(): void {
  const on = isFullscreen();
  viewport.classList.toggle("is-full", on);
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  for (const { group, home } of dockedGroups) {
    if (on && group.parentElement !== dock) dock.append(group);
    else if (!on && group.parentElement === dock) home.after(group);
  }
  if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
  fullscreenButton.setAttribute("aria-pressed", String(on));
  fullscreenButton.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
  fullscreenButton.title = (on ? "Exit full screen" : "Full screen") + " (F)";
}
function setExpanded(on: boolean): void {
  viewport.classList.toggle("expanded", on);
  document.body.classList.toggle("viewer-expanded", on);
  syncFullscreen();
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else if (viewport.classList.contains("expanded")) setExpanded(false);
  else if (document.fullscreenEnabled) viewport.requestFullscreen().catch(() => setExpanded(true));
  else setExpanded(true);
}
fullscreenButton.addEventListener("click", toggleFullscreen);
// Puts the camera and zoom back without touching the slice.
function resetView(): void {
  Object.assign(state, defaultCamera, { zoom: defaultView.zoom });
  scheduleDraw();
}
byId("reset-view").addEventListener("click", resetView);
document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && viewport.classList.contains("expanded")) setExpanded(false);
});

svg.addEventListener("keydown", event => {
  const direction = orbitKeys[event.key];
  const zoom = zoomKeys[event.key];
  if (direction) orbit(...direction);
  else if (zoom) zoomBy(zoom);
  else if (event.metaKey || event.ctrlKey || event.altKey) return;
  else if (event.key === "f" || event.key === "F") toggleFullscreen();
  else if (event.key === "r" || event.key === "R") resetView();
  else return;
  event.preventDefault();
});
new ResizeObserver(([entry]) => {
  scene.width = entry.contentRect.width;
  scene.height = entry.contentRect.height;
  svg.setAttribute("viewBox", "0 0 " + scene.width + " " + scene.height);
  scheduleDraw();
}).observe(stage);

// The primer's tesseract step can open its current slice here.
initPrimer((angles, offset) => {
  Object.assign(state, { angles, offset });
  setView({ sweep: false });
  update();
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  viewport.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  svg.focus({ preventScroll: true });
});

update();
