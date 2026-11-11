// "One dimension down" primer: a sphere or cube crossing a 2D wall, then a
// hypersphere or tesseract crossing 3D space, to show what the explorer does.
import { dot, slice, type Vector } from "./geometry";
import { shapeName } from "./shapes";

type StepId = "sphere" | "cube" | "hypersphere" | "tesseract";
type Tilt = "straight" | "tilted" | "corner";
interface Poly { points: Vector[]; normal: Vector }
/** A slice ready to draw. Points are 3D; flat slices lie in z = 0. */
/** Round 3D slices are spheres of `radius` around the origin, drawn as shaded discs. */
interface Section { points: Vector[]; faces: Poly[]; dimension: number; name: string; radius?: number }
interface Camera { yaw: number; pitch: number }
interface Box { x: number; y: number; w: number; h: number }
interface Projector { orient: (vector: Vector) => Vector; cx: number; cy: number; scale: number }
interface Style { hue: number; sat: number; lo: number; hi: number; stroke?: string; width?: number }

const cornerTilt = Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI;
// 3D plane rotations as [axis, axis, degrees], applied in order; Z is the slicing axis.
const cubeTilts: Record<Tilt, [number, number, number][]> = {
  straight: [],
  tilted: [[0, 2, 45]],
  corner: [[0, 2, 45], [1, 2, cornerTilt]],
};
// The same three orientations one dimension up, in the explorer's XW YW ZW XY XZ YZ order.
const tesseractTilts: Record<Tilt, number[]> = {
  straight: [0, 0, 0, 0, 0, 0],
  tilted: [45, 0, 0, 0, 0, 0],
  corner: [45, cornerTilt, 30, 0, 0, 0],
};

const steps: Record<StepId, { dims: 3 | 4; noun: string; analog: StepId; title: string; text: string }> = {
  sphere: {
    dims: 3, noun: "sphere", analog: "sphere",
    title: "A sphere passes through a wall",
    text: "Picture someone who lives on the wall and can only see along it. As the ball passes through, they never see the ball. They see a dot appear, grow into a circle, shrink, and vanish.",
  },
  cube: {
    dims: 3, noun: "cube", analog: "cube",
    title: "A cube passes through a wall",
    text: "Pushed straight through, a cube leaves the same square on the wall the whole way. Tilt it and the wall sees other shapes: rectangles, or a triangle that grows into a hexagon when a corner leads.",
  },
  hypersphere: {
    dims: 4, noun: "hypersphere", analog: "sphere",
    title: "A hypersphere passes through our space",
    text: "Now go up one dimension. A ball is a stack of circles along Z; a 4D ball is a stack of spheres along W. Passing through our space it would look like a point that swells into a sphere, then shrinks away.",
  },
  tesseract: {
    dims: 4, noun: "tesseract", analog: "cube",
    title: "A tesseract passes through our space",
    text: "A cube is a square stretched along Z; a tesseract is a cube stretched along W. Straight on, every slice is the same cube. Tilt it in 4D and the slices become boxes, tetrahedra and octahedra, which is what the explorer above shows.",
  },
};

const epsilon = 1e-7;
const travel = 1.3; // The slider runs past the shape's extent so it can fully enter and leave.
const light = [-0.28, 0.67, 0.69];
const objectStyle: Style = { hue: 35, sat: 7, lo: 26, hi: 60, stroke: "#bdb5aa", width: 1.1 };
const roundObjectStyle: Style = { hue: 35, sat: 7, lo: 22, hi: 64 };
const sliceStyle: Style = { hue: 28, sat: 42, lo: 27, hi: 52, stroke: "#e9a970", width: 1.4 };
const flatFill = "hsl(28 58% 47%)";
const flatStroke = "#f3d1b3";

// ---------- Geometry ----------

function rotate3(vector: Vector, rotations: [number, number, number][]): Vector {
  const result = [...vector];
  for (const [a, b, degrees] of rotations) {
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const first = result[a], second = result[b];
    result[a] = cosine * first - sine * second;
    result[b] = sine * first + cosine * second;
  }
  return result;
}

const cubeVertices: Vector[] = Array.from({ length: 8 }, (_, index) =>
  [0, 1, 2].map(axis => (index & (1 << axis)) === 0 ? -1 : 1)
);
const cubeEdges: [number, number][] = cubeVertices.flatMap((_, index) =>
  [1, 2, 4].filter(bit => (index & bit) === 0).map((bit): [number, number] => [index, index | bit])
);
const cubeFaces: Poly[] = [0, 1, 2].flatMap(axis => [-1, 1].map(sign => {
  const [u, v] = [0, 1, 2].filter(other => other !== axis);
  const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const point = [0, 0, 0];
    point[axis] = sign;
    point[u] = a;
    point[v] = b;
    return point;
  });
  return { points, normal: [0, 1, 2].map(index => index === axis ? sign : 0) };
}));

function sphereMesh(bands: number, segments: number): Poly[] {
  const at = (band: number, segment: number): Vector => {
    const theta = band / bands * Math.PI, phi = segment / segments * 2 * Math.PI;
    return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
  };
  const faces: Poly[] = [];
  for (let band = 0; band < bands; band++) {
    for (let segment = 0; segment < segments; segment++) {
      const points = [at(band, segment), at(band, segment + 1), at(band + 1, segment + 1), at(band + 1, segment)];
      const center = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / 4);
      const size = Math.hypot(...center);
      faces.push({ points, normal: center.map(value => value / size) });
    }
  }
  return faces;
}
const sphere = sphereMesh(18, 36);

const placeMesh = (mesh: Poly[], radius: number, offset: Vector): Poly[] =>
  mesh.map(({ points, normal }) => ({ points: points.map(point => point.map((value, axis) => value * radius + offset[axis])), normal }));

const titleCase = (text: string): string => text[0].toUpperCase() + text.slice(1);
const empty = (): Section => ({ points: [], faces: [], dimension: 0, name: "" });

/** Builds a flat section from points already ordered around z = 0. */
function flatSection(points: Vector[]): Section {
  if (points.length === 0) return empty();
  if (points.length === 1) return { points, faces: [], dimension: 0, name: "Point" };
  if (points.length === 2) return { points, faces: [], dimension: 1, name: "Line" };
  const indices = points.map((_, index) => index);
  const normal = [0, 0, 1];
  const name = shapeName({ points, faces: [{ indices, normal }], dimension: 2 }).replace(/^Flat /, "");
  return { points, faces: [{ points, normal }], dimension: 2, name: titleCase(name) };
}

function circleSection(position: number): Section {
  const squared = 1 - position * position;
  if (squared < -epsilon) return empty();
  if (squared < 1e-4) return { points: [[0, 0, 0]], faces: [], dimension: 0, name: "Point" };
  const radius = Math.sqrt(squared);
  const points = Array.from({ length: 72 }, (_, index) => {
    const angle = index / 72 * 2 * Math.PI;
    return [radius * Math.cos(angle), radius * Math.sin(angle), 0];
  });
  return { points, faces: [{ points, normal: [0, 0, 1] }], dimension: 2, name: "Circle · radius " + radius.toFixed(2) };
}

function squareSection(tilt: Tilt, position: number): Section {
  const rotated = cubeVertices.map(vertex => rotate3(vertex, cubeTilts[tilt]));
  const points: Vector[] = [];
  const add = (point: Vector) => {
    const flat = [point[0], point[1], 0];
    if (!points.some(existing => Math.hypot(existing[0] - flat[0], existing[1] - flat[1]) < epsilon)) points.push(flat);
  };
  for (const [first, second] of cubeEdges) {
    const a = rotated[first], b = rotated[second];
    const da = a[2] - position, db = b[2] - position;
    if (Math.abs(da) < epsilon) add(a);
    if (Math.abs(db) < epsilon) add(b);
    if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
      const t = da / (da - db);
      add(a.map((value, axis) => value + t * (b[axis] - value)));
    }
  }
  const cx = points.reduce((sum, point) => sum + point[0], 0) / (points.length || 1);
  const cy = points.reduce((sum, point) => sum + point[1], 0) / (points.length || 1);
  points.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  return flatSection(points);
}

function ballSection(position: number): Section {
  const squared = 1 - position * position;
  if (squared < -epsilon) return empty();
  if (squared < 1e-4) return { points: [[0, 0, 0]], faces: [], dimension: 0, name: "Point" };
  const radius = Math.sqrt(squared);
  return { points: [[0, 0, 0]], faces: [], dimension: 3, name: "Sphere · radius " + radius.toFixed(2), radius };
}

function tesseractSection(tilt: Tilt, position: number): Section {
  const result = slice(tesseractTilts[tilt], position);
  if (result.points.length === 0) return empty();
  const faces = result.faces.map(({ indices, normal }) => ({ points: indices.map(index => result.points[index]), normal }));
  const name = shapeName(result).replace(/^Flat /, "").replace(/ slice$/, "");
  return { points: result.points, faces, dimension: result.dimension, name: titleCase(name) };
}

function extentOf(step: StepId, tilt: Tilt): number {
  if (step === "sphere" || step === "hypersphere") return 1;
  if (step === "cube") return Math.max(...cubeVertices.map(vertex => rotate3(vertex, cubeTilts[tilt])[2]));
  return slice(tesseractTilts[tilt], 0).extent;
}

function sectionOf(step: StepId, tilt: Tilt, position: number): Section {
  switch (step) {
    case "sphere": return circleSection(position);
    case "cube": return squareSection(tilt, position);
    case "hypersphere": return ballSection(position);
    case "tesseract": return tesseractSection(tilt, position);
  }
}

// ---------- Drawing ----------

function orientFor({ yaw, pitch }: Camera): (vector: Vector) => Vector {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return ([x, y, z]) => {
    const depth = sy * x + cy * z;
    return [cy * x - sy * z, cp * y - sp * depth, sp * y + cp * depth];
  };
}
const flatOrient = (vector: Vector): Vector => vector;

function toScreen({ orient, cx, cy, scale }: Projector, point: Vector): Vector {
  const [x, y, z] = orient(point);
  return [cx + x * scale, cy - y * scale, z];
}
const xy = (point: Vector): string => point[0].toFixed(1) + "," + point[1].toFixed(1);

function solid(polys: Poly[], projector: Projector, style: Style): string {
  return polys
    .map(({ points, normal }) => {
      const screen = points.map(point => toScreen(projector, point));
      return { screen, normal: projector.orient(normal), depth: screen.reduce((sum, point) => sum + point[2], 0) / screen.length };
    })
    .filter(face => face.normal[2] >= -1e-6)
    .sort((a, b) => a.depth - b.depth)
    .map(({ screen, normal }) => {
      const lightness = style.lo + (style.hi - style.lo) * Math.max(0, dot(normal, light));
      const fill = `hsl(${style.hue} ${style.sat}% ${lightness.toFixed(1)}%)`;
      return `<polygon points="${screen.map(xy).join(" ")}" fill="${fill}" stroke="${style.stroke ?? fill}" stroke-width="${style.width ?? 0.7}" stroke-linejoin="round"/>`;
    })
    .join("");
}

/** Draws a slice; `outline` draws only its edge, to show the cut through a shape in front of it. */
function sectionSvg(section: Section, projector: Projector, outline = false): string {
  const screen = section.points.map(point => toScreen(projector, point));
  if (section.radius !== undefined) {
    // A sphere looks like a disc from every angle; the gradient (in index.html) does the shading.
    const [x, y] = screen[0];
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(section.radius * projector.scale).toFixed(1)}" fill="url(#primer-ball)" stroke="#e9a970" stroke-opacity="0.45"/>`;
  }
  if (section.dimension === 3) return solid(section.faces, projector, sliceStyle);
  if (section.dimension === 2) {
    const fill = outline ? `fill="none"` : `fill="${flatFill}" fill-opacity="0.9"`;
    return `<polygon points="${screen.map(xy).join(" ")}" ${fill} stroke="${flatStroke}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  if (section.dimension === 1) {
    return `<path d="M${xy(screen[0])}L${xy(screen[1])}" stroke="${flatStroke}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return screen.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${flatStroke}"/>`).join("");
}

/** Keeps the part of a polygon on one side of the wall (z = 0). */
function clip(points: Vector[], side: number): Vector[] {
  const kept: Vector[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    const da = side * a[2], db = side * b[2];
    if (da >= 0) kept.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      kept.push(a.map((value, axis) => value + t * (b[axis] - value)));
    }
  });
  return kept;
}

const wallSize = [2.4, 1.6];

function wallScene(box: Box, step: StepId, tilt: Tilt, position: number, section: Section, camera: Camera): string {
  const projector: Projector = {
    orient: orientFor(camera),
    cx: box.x + box.w / 2,
    cy: box.y + box.h * 0.54,
    scale: Math.min(box.w / 6.6, box.h / 4.6),
  };
  const at = (point: Vector) => xy(toScreen(projector, point));
  // The object sits at -position along Z, so the wall (z = 0) cuts it at `position`.
  const shift = (point: Vector): Vector => [point[0], point[1], point[2] - position];
  const round = step === "sphere";
  const polys: Poly[] = round
    ? placeMesh(sphere, 1, [0, 0, -position])
    : cubeFaces.map(({ points, normal }) => ({
        points: points.map(point => shift(rotate3(point, cubeTilts[tilt]))),
        normal: rotate3(normal, cubeTilts[tilt]),
      }));
  const [back, front] = [-1, 1].map(side => polys.flatMap(({ points, normal }) => {
    const kept = clip(points, side);
    return kept.length >= 3 ? [{ points: kept, normal }] : [];
  }));
  const style = round ? roundObjectStyle : objectStyle;
  const [w, h] = wallSize;
  const parts: string[] = [];
  parts.push(`<path d="M${at([0, 0, -2.9])}L${at([0, 0, 0])}" stroke="#8a837a" stroke-dasharray="3 5" stroke-width="1"/>`);
  parts.push(solid(back, projector, style));
  parts.push(`<polygon points="${[[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(at).join(" ")}" fill="#25302f" fill-opacity="0.8" stroke="#76c5c1" stroke-width="1.3" stroke-linejoin="round"/>`);
  const grid: string[] = [];
  for (let x = -2; x <= 2; x += 0.5) grid.push(`M${at([x, -h, 0])}L${at([x, h, 0])}`);
  for (let y = -1.5; y <= 1.5; y += 0.5) grid.push(`M${at([-w, y, 0])}L${at([w, y, 0])}`);
  parts.push(`<path d="${grid.join("")}" stroke="#48b2ac" stroke-opacity="0.16" stroke-width="1"/>`);
  const [lx, ly] = toScreen(projector, [-w + 0.12, h - 0.2, 0]);
  parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#76c5c1" font-size="9.5" font-family="ui-monospace, monospace" letter-spacing="1.2">THE WALL</text>`);
  parts.push(sectionSvg(section, projector));
  parts.push(`<path d="M${at([0, 0, 0])}L${at([0, 0, 2.9])}" stroke="#8a837a" stroke-dasharray="3 5" stroke-width="1"/>`);
  // The part in front of the wall is see-through so the slice behind it stays visible.
  parts.push(`<g opacity="0.5">${solid(front, projector, style)}</g>`);
  parts.push(sectionSvg(section, projector, true));
  return parts.join("");
}

function flatWall(box: Box, section: Section): string {
  const [w, h] = wallSize;
  const projector: Projector = {
    orient: flatOrient, cx: box.x + box.w / 2, cy: box.y + box.h * 0.52,
    scale: Math.min((box.w - 36) / (2 * w), (box.h - 110) / (2 * h)),
  };
  const at = (point: Vector) => xy(toScreen(projector, point));
  const grid: string[] = [];
  for (let x = -2; x <= 2; x += 0.5) grid.push(`M${at([x, -h, 0])}L${at([x, h, 0])}`);
  for (let y = -1.5; y <= 1.5; y += 0.5) grid.push(`M${at([-w, y, 0])}L${at([w, y, 0])}`);
  return `<polygon points="${[[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(at).join(" ")}" fill="#25302f" stroke="#76c5c1" stroke-width="1.3"/>`
    + `<path d="${grid.join("")}" stroke="#48b2ac" stroke-opacity="0.16" stroke-width="1"/>`
    + sectionSvg(section, projector);
}

interface StripOptions {
  extent: number;
  position: number;
  axis: string;
  label: string;
  at: (position: number) => Section;
  camera?: Camera; // Flat slices are drawn face on; solid ones through this camera.
}

/** Lays a shape out along its slicing axis as a row of slices, with the live one marked. */
function strip(box: Box, { extent, position, axis, label, at, camera }: StripOptions): string {
  const count = 7;
  const pad = 18;
  const top = box.y + 26;
  const axisY = box.y + box.h - 18;
  const cell = (box.w - 2 * pad) / count;
  const size = Math.max(10, Math.min(cell * 0.96, axisY - top - 8));
  const cy = (top + axisY - 6) / 2;
  const scale = size / (camera ? 3.5 : 3.1);
  const xAt = (value: number) => box.x + pad + cell / 2 + (value + extent) / (2 * extent) * (box.w - 2 * pad - cell);
  const projector = (cx: number): Projector => ({ orient: camera ? orientFor(camera) : flatOrient, cx, cy, scale });
  const parts: string[] = [];
  parts.push(`<text x="${box.x + pad}" y="${box.y + 16}" fill="#b0a89e" font-size="10" font-family="ui-monospace, monospace" letter-spacing="0.6">${label}</text>`);
  parts.push(`<path d="M${box.x + pad},${axisY}H${box.x + box.w - pad - 4}" stroke="#55504a" stroke-width="1"/>`);
  parts.push(`<path d="M${box.x + box.w - pad - 9},${axisY - 4}l5,4l-5,4" fill="none" stroke="#55504a" stroke-width="1"/>`);
  parts.push(`<text x="${box.x + box.w - pad}" y="${axisY + 14}" fill="#b0a89e" font-size="10" font-family="ui-monospace, monospace" text-anchor="end">${axis}</text>`);
  const ghosts: string[] = [];
  for (let index = 0; index < count; index++) {
    const value = -extent + 2 * extent * index / (count - 1);
    const x = xAt(value);
    parts.push(`<path d="M${x.toFixed(1)},${axisY - 3}v6" stroke="#55504a" stroke-width="1"/>`);
    ghosts.push(sectionSvg(at(value), projector(x)));
  }
  parts.push(`<g opacity="0.3">${ghosts.join("")}</g>`);
  if (Math.abs(position) <= extent + epsilon) {
    const x = xAt(position).toFixed(1);
    parts.push(`<path d="M${x},${top - 6}V${axisY}" stroke="#48b2ac" stroke-width="1.4" stroke-opacity="0.8"/>`);
    parts.push(`<circle cx="${x}" cy="${axisY}" r="3.5" fill="#76c5c1"/>`);
    parts.push(sectionSvg(at(position), projector(Number(x))));
  }
  return parts.join("");
}

// ---------- App ----------

function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing element: #" + id);
  return element as Element as T;
}

const signed = (value: number): string => {
  const rounded = Number(value.toFixed(2));
  return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + Math.abs(rounded).toFixed(2);
};

/** Sets up the primer. `explore` opens a tesseract orientation and slice in the main explorer. */
export function initPrimer(explore: (angles: number[], offset: number) => void): void {
  const root = byId("primer");
  const outside = byId<SVGSVGElement>("primer-outside");
  const inside = byId<SVGSVGElement>("primer-inside");
  const outsideShape = byId<SVGGElement>("primer-outside-shape");
  const insideShape = byId<SVGGElement>("primer-inside-shape");
  const range = byId<HTMLInputElement>("primer-position");
  const value = byId("primer-value");
  const play = byId<HTMLButtonElement>("primer-play");
  const tiltGroup = byId("primer-tilt");
  const exploreButton = byId<HTMLButtonElement>("primer-explore");
  const stepButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-step]")];
  const tiltButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-tilt]")];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    step: "sphere" as StepId,
    tilt: "straight" as Tilt,
    t: -0.45, // Position as a fraction of the shape's extent.
    playing: false,
    visible: false,
    touched: false,
    direction: 1,
    scene: { yaw: -0.82, pitch: 0.3 } as Camera,
    solid: { yaw: -0.55, pitch: 0.42 } as Camera,
  };
  const size = new Map<SVGSVGElement, [number, number]>();
  let frame = 0;

  function render(): void {
    const { step, tilt } = state;
    const config = steps[step];
    const axis = config.dims === 3 ? "Z" : "W";
    const extent = extentOf(step, tilt);
    const position = state.t * extent;
    const section = sectionOf(step, tilt, position);
    const [ow, oh] = size.get(outside) ?? [0, 0];
    const [iw, ih] = size.get(inside) ?? [0, 0];

    if (ow && oh) {
      if (config.dims === 3) {
        const stripHeight = Math.max(74, Math.min(110, oh * 0.25));
        const head = 56; // Keeps the scene clear of the pane title.
        outsideShape.innerHTML = wallScene({ x: 0, y: head, w: ow, h: oh - stripHeight - head }, step, tilt, position, section, state.scene)
          + `<path d="M0,${oh - stripHeight}H${ow}" stroke="#4a4540"/>`
          + strip({ x: 0, y: oh - stripHeight, w: ow, h: stripHeight }, {
            extent, position, axis: "Z", label: `EVERY SLICE OF THE ${config.noun.toUpperCase()}, LAID OUT ALONG Z`,
            at: value => sectionOf(step, tilt, value),
          });
      } else {
        // 4D can't be drawn whole, so show the 3D shape and its 4D cousin as rows of slices.
        const analog = config.analog;
        const analogExtent = extentOf(analog, tilt);
        const head = 64;
        const split = head + (oh - head) * 0.38;
        outsideShape.innerHTML = strip({ x: 0, y: head, w: ow, h: split - head }, {
          extent: analogExtent, position: state.t * analogExtent, axis: "Z",
          label: `3D · A ${steps[analog].noun.toUpperCase()} IS A STACK OF SLICES ALONG Z`,
          at: value => sectionOf(analog, tilt, value),
        }) + `<path d="M18,${split}H${ow - 18}" stroke="#4a4540" stroke-dasharray="2 4"/>`
          + strip({ x: 0, y: split + 4, w: ow, h: oh - split - 4 }, {
            extent, position, axis: "W",
            label: `4D · A ${config.noun.toUpperCase()} IS A STACK OF SLICES ALONG W`,
            at: value => sectionOf(step, tilt, value), camera: state.solid,
          });
      }
    }

    if (iw && ih) {
      if (config.dims === 3) {
        insideShape.innerHTML = flatWall({ x: 0, y: 0, w: iw, h: ih }, section);
      } else {
        const projector: Projector = { orient: orientFor(state.solid), cx: iw / 2, cy: ih * 0.52, scale: Math.min(iw, ih) * 0.2 };
        insideShape.innerHTML = sectionSvg(section, projector);
      }
    }

    const before = position < 0;
    const noun = config.noun;
    const where = config.dims === 3 ? "the wall" : "our space";
    const readout = section.name
      || (before ? `Nothing yet. The ${noun} hasn't reached ${where}.` : `Gone. The ${noun} has passed through ${where}.`);
    byId("primer-readout").textContent = readout;
    const coordinate = `${axis} = ${signed(position)}`;
    value.textContent = coordinate;
    range.setAttribute("aria-valuetext", coordinate);
    range.value = String(state.t);
    range.style.setProperty("--position", (state.t + travel) / (2 * travel) * 100 + "%");
    outside.setAttribute("aria-label", config.dims === 3
      ? `A ${noun} crossing a flat wall at ${coordinate}, with every slice laid out along Z below.`
      : `Every slice of a ${steps[config.analog].noun} laid out along Z, above every slice of a ${noun} laid out along W, marked at ${coordinate}.`);
    inside.setAttribute("aria-label", `${config.dims === 3 ? "What the wall sees" : "What we see"}: ${readout}`);
  }

  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function sync(): void {
    const config = steps[state.step];
    for (const button of stepButtons) button.setAttribute("aria-pressed", String(button.dataset.step === state.step));
    for (const button of tiltButtons) button.setAttribute("aria-pressed", String(button.dataset.tilt === state.tilt));
    tiltGroup.hidden = state.step === "sphere" || state.step === "hypersphere";
    exploreButton.hidden = state.step !== "tesseract";
    byId("primer-step-title").textContent = config.title;
    byId("primer-step-text").textContent = config.text;
    byId("primer-outside-title").textContent = config.dims === 3 ? `The ${config.noun} and the wall` : "Too big to draw whole, so lay it out";
    byId("primer-inside-title").textContent = config.dims === 3 ? "What the wall sees" : "What we see in 3D";
    inside.classList.toggle("draggable", config.dims === 4);
    play.setAttribute("aria-pressed", String(state.playing));
    play.querySelector("span")!.textContent = state.playing ? "Pause" : "Play";
    animate();
    schedule();
  }

  // Sweeps the shape back and forth through the wall while the section is on screen.
  const speed = 0.42; // fraction of the travel per second
  let animationFrame = 0;
  let last = 0;
  function animate(): void {
    const running = state.playing && state.visible;
    if (!running) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    if (animationFrame) return;
    last = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }
  function tick(now: number): void {
    const seconds = Math.min(0.05, (now - last) / 1000);
    last = now;
    let t = state.t + state.direction * speed * seconds;
    if (Math.abs(t) >= travel) {
      t = Math.sign(t) * travel;
      state.direction = -Math.sign(t);
    }
    state.t = t;
    render();
    animationFrame = requestAnimationFrame(tick);
  }

  for (const button of stepButtons) {
    button.addEventListener("click", () => {
      state.step = button.dataset.step as StepId;
      sync();
    });
  }
  for (const button of tiltButtons) {
    button.addEventListener("click", () => {
      state.tilt = button.dataset.tilt as Tilt;
      sync();
    });
  }
  range.addEventListener("input", () => {
    state.t = range.valueAsNumber;
    state.playing = false;
    state.touched = true;
    sync();
  });
  play.addEventListener("click", () => {
    state.playing = !state.playing;
    state.touched = true;
    sync();
  });
  exploreButton.addEventListener("click", () => {
    const position = state.t * extentOf(state.step, state.tilt);
    state.playing = false;
    sync();
    explore([...tesseractTilts[state.tilt]], Math.round(Math.max(-2, Math.min(2, position)) * 100) / 100);
  });

  // Drag turns the 3D views; vertical touch drags still scroll the page.
  for (const svg of [outside, inside]) {
    let pointer: { id: number; x: number; y: number } | undefined;
    const camera = () => steps[state.step].dims === 3 ? (svg === outside ? state.scene : undefined) : state.solid;
    svg.addEventListener("pointerdown", event => {
      if (!camera() || (event.pointerType === "mouse" && event.button !== 0)) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", event => {
      const target = camera();
      if (!pointer || pointer.id !== event.pointerId || !target) return;
      // The wall scene stays in front of the wall so the back of the shape is always behind it.
      const limit = target === state.scene ? 1.35 : Infinity;
      target.yaw = Math.max(-limit, Math.min(limit, target.yaw + (event.clientX - pointer.x) * 0.009));
      if (event.pointerType === "mouse") {
        const [low, high] = target === state.scene ? [-0.45, 1.05] : [-1.48, 1.48];
        target.pitch = Math.max(low, Math.min(high, target.pitch + (event.clientY - pointer.y) * 0.009));
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      schedule();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      svg.addEventListener(type, () => { pointer = undefined; });
    }
  }
  outside.classList.add("draggable");

  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const svg = entry.target as SVGSVGElement;
      const { width, height } = entry.contentRect;
      size.set(svg, [width, height]);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    schedule();
  });
  resize.observe(outside);
  resize.observe(inside);

  // Start sweeping the first time the section scrolls into view, unless motion is reduced.
  new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible && !state.touched && !reducedMotion.matches) {
      state.playing = true;
      state.touched = true;
      sync();
    }
    animate();
  }, { threshold: 0.35 }).observe(byId("primer-stage"));

  sync();
}
