// App state, UI, rendering, and input.
import "./styles.css";
import { dot, planes, slice, type Angles, type Slice, type Vector } from "./geometry";
import { shapeName } from "./shapes";

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
  challenge: boolean;
  solved: boolean;
  unlocked: boolean;
  best: number;
}
type ToggleKey = "hiddenEdges" | "spin" | "sweep";
type Counts = [vertices: number, edges: number, faces: number];

const sampleAngles: Partial<Record<string, readonly number[]>> = {
  cube: [0, 0, 0, 0, 0, 0],
  prism: [45, 35, 0, 0, 0, 0],
  octahedron: [45, Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI, 30, 0, 0, 0],
};

const introAngles = [32, -25, 19, 0, 0, 0];
const challengeAngles = [34, 0, 28, 0, 0, 0];
const defaultCamera: Camera = { yaw: -0.52, pitch: 0.39 };
const defaultView: View = { zoom: 1, hiddenEdges: true, spin: false, sweep: false };
const zoomLimits = [0.5, 3] as const;
const bestKey = "hyperslice.bestWindow";
const state: State = {
  angles: [...introAngles],
  offset: 0.35,
  ...defaultCamera,
  challenge: false,
  solved: false,
  unlocked: false,
  best: loadBest(),
  ...defaultView,
};
function loadBest(): number {
  try { return Number(localStorage.getItem(bestKey)) || 0; } catch { return 0; }
}
function saveBest(value: number): void {
  try { localStorage.setItem(bestKey, String(value)); } catch { /* storage unavailable */ }
}

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
const presets = [...document.querySelectorAll<HTMLButtonElement>("[data-preset]")];
const challengeButton = byId<HTMLButtonElement>("challenge");
const challengeCard = required(challengeButton.closest(".challenge"), ".challenge");
const challengeHint = byId("challenge-hint");
const challengeStatus = byId("challenge-status");
const challengeScore = byId("challenge-score");
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
      <output for="plane-${name}"></output>
    </div>
    <input type="range" id="plane-${name}" min="-180" max="180" step="0.1">
  `;
  target.append(row);
  const input = required(row.querySelector("input"), "plane input");
  input.addEventListener("input", () => {
    state.angles[index] = input.valueAsNumber;
    update();
  });
  return { input, output: required(row.querySelector("output"), "plane output") };
});

function rangePosition(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.style.setProperty("--position", (value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100 + "%");
}

function update(): void {
  const current = geometry = slice(state.angles, state.offset);
  const preset = Object.entries(sampleAngles).find(([, angles]) =>
    state.offset === 0 && angles?.every((angle, index) => angle === state.angles[index])
  )?.[0];
  for (const button of presets) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }

  rotationInputs.forEach(({ input, output }, index) => {
    const value = state.angles[index];
    rangePosition(input, value);
    output.textContent = degrees(value);
    input.setAttribute("aria-valuetext", output.textContent);
  });
  const offset = signed(state.offset, 2);
  rangePosition(depth, state.offset);
  depth.setAttribute("aria-valuetext", offset);
  byId("depth-value").textContent = offset;
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
  const matched = state.challenge && current.dimension === 3 && counts[0] === 4 && counts[1] === 6 && counts[2] === 4;
  state.unlocked = matched;
  const gap = current.cornerGap;
  if (matched) {
    state.solved = true;
    if (gap > state.best + 1e-9) {
      state.best = gap;
      saveBest(gap);
    }
  }
  const { hint, status, score } = challengeText(matched, gap);
  if (challengeHint.textContent !== hint) challengeHint.textContent = hint;
  // The live region only changes on milestones; the per-tick numbers live in the score line.
  if (challengeStatus.textContent !== status) challengeStatus.textContent = status;
  challengeStatus.classList.toggle("closed", state.solved && !matched);
  challengeScore.innerHTML = score;
  showOpenWindow(state.challenge && state.solved ? current : null);
  challengeCard.classList.toggle("unlocked", matched);
  const buttonLabel = state.challenge ? "Restart " : "Try the lock ";
  const labelNode = challengeButton.firstChild;
  if (labelNode && labelNode.textContent !== buttonLabel) labelNode.textContent = buttonLabel;
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

const perfectWindow = 0.995;
function windowRating(gap: number): string {
  if (gap >= perfectWindow) return "Perfect window";
  if (gap >= 0.8) return "Great window";
  if (gap >= 0.5) return "Good window";
  return "Keep widening";
}

function challengeText(matched: boolean, gap: number): { hint: string; status: string; score: string } {
  const bestValue = `<b>${state.best.toFixed(2)}</b>`;
  const bestLine = state.best > 0 ? `Best window ${bestValue} / 1.00` : "";
  if (!state.challenge) {
    return { hint: "Find a tetrahedral slice with 4 vertices, 6 edges, and 4 faces.", status: "", score: bestLine };
  }
  if (!state.solved) {
    return { hint: "Turn YW until the slice has 4 vertices, 6 edges, and 4 faces.", status: "", score: bestLine };
  }
  const best = state.best > 0 ? ` · best ${bestValue}` : "";
  const hint = matched && gap >= perfectWindow
    ? "Perfect. W now runs along the tesseract's long diagonal, so one corner pokes through a full unit before its neighbours."
    : "Unlocked. The gold band on the slice slider shows where the lock stays open. Turn any W plane to widen it. The widest possible is 1.00.";
  return {
    hint,
    status: matched ? "Unlocked · " + windowRating(gap) : "Lock closed · move W back into the gold band",
    score: `Window <b>${gap.toFixed(2)}</b> / 1.00${best}`,
  };
}

// Paints the W ranges that hold a lone corner onto the slice slider's track.
function showOpenWindow(result: Slice | null): void {
  if (!result || result.cornerGap < 1e-9) {
    depth.style.removeProperty("--window");
    return;
  }
  const span = Number(depth.max) - Number(depth.min);
  const at = (value: number) => ((value - Number(depth.min)) / span * 100).toFixed(2) + "%";
  const inner = result.extent - result.cornerGap;
  const outer = result.extent;
  const band = (from: number, to: number) =>
    `transparent ${at(from)}, var(--gold) ${at(from)}, var(--gold) ${at(to)}, transparent ${at(to)}`;
  depth.style.setProperty("--window", `linear-gradient(to right, ${band(-outer, -inner)}, ${band(inner, outer)})`);
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
  byId("grid").innerHTML = `<g stroke="#5a544d" stroke-width="1" fill="none">${grid.join("")}</g>`;

  const points = geometry.points.map(project);
  const front = new Set<number>();
  const light = [-0.28, 0.67, 0.69];
  const open = state.unlocked;
  const hue = open ? 177 : 28;
  const fragments: string[] = [];
  const faceLayers = geometry.faces.map(({ indices, normal }) => ({
    indices,
    normal: orient(normal),
    depth: indices.reduce((sum, index) => sum + points[index][2], 0) / indices.length,
  })).sort((a, b) => a.depth - b.depth);

  const outline = open ? "#76c5c1" : "#e9a970";
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
    fragments.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.65" fill="${open ? "#b6e0de" : "#f3d1b3"}"/>`);
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
  ).join("")}<circle cx="27" cy="32" r="2" fill="#e6e1da"/></svg>`;
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
for (const button of presets) {
  button.addEventListener("click", () => {
    const angles = sampleAngles[button.dataset.preset ?? ""];
    if (!angles) return;
    state.angles = [...angles];
    state.offset = 0;
    setView({ sweep: false });
    update();
  });
}
byId("reset").addEventListener("click", () => {
  Object.assign(state, { angles: [...introAngles], offset: 0.35, ...defaultCamera, challenge: false, solved: false });
  setView(defaultView);
  spatialDetails.open = false;
  update();
});
challengeButton.addEventListener("click", () => {
  Object.assign(state, { angles: [...challengeAngles], offset: 1.25, challenge: true, solved: false });
  setView({ sweep: false });
  update();
  rotationInputs[1].input.focus();
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
svg.addEventListener("keydown", event => {
  const direction = orbitKeys[event.key];
  const zoom = zoomKeys[event.key];
  if (direction) orbit(...direction);
  else if (zoom) zoomBy(zoom);
  else return;
  event.preventDefault();
});
new ResizeObserver(([entry]) => {
  scene.width = entry.contentRect.width;
  scene.height = entry.contentRect.height;
  svg.setAttribute("viewBox", "0 0 " + scene.width + " " + scene.height);
  scheduleDraw();
}).observe(stage);

update();
