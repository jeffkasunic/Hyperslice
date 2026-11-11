// "One dimension down" primer: a sphere or cube crossing a 2D wall, then a
// hypersphere or tesseract crossing 3D space, to show what the explorer does.
import { dot, slice, type Vector } from "./geometry";
import { shapeName } from "./shapes";

/** "circle", "square", "triangle" and "pyramid" are only lower-dimension rows drawn beside 4D steps; they have no step buttons. */
type StepId = "line" | "sphere" | "cube" | "hypersphere" | "tesseract" | "circle" | "square" | "triangle" | "pyramid" | "cube-pyramid";
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
// The same idea one dimension down: a square turned in the X/Y plane, sliced along Y.
// In 2D, tilting 45° already puts a corner first, so the last two match.
const squareTilts: Record<Tilt, number> = { straight: 0, tilted: 45, corner: 45 };
// The same three orientations one dimension up, in the explorer's XW YW ZW XY XZ YZ order.
const tesseractTilts: Record<Tilt, number[]> = {
  straight: [0, 0, 0, 0, 0, 0],
  tilted: [45, 0, 0, 0, 0, 0],
  corner: [45, cornerTilt, 30, 0, 0, 0],
};

interface Step {
  dims: 2 | 3 | 4;
  noun: string;
  /** For 4D steps: the same idea in lower dimensions, drawn as rows above, lowest first. */
  analogs: StepId[];
  title: string;
  text: string;
}
const steps: Record<StepId, Step> = {
  line: {
    dims: 3, noun: "line", analogs: [],
    title: "A line passes through a wall",
    text: "Start with the simplest case. A line crossing the wall touches it at just one point. Someone living on the wall sees a dot appear, stay put while the line slides through, then vanish. They never see the line itself, only how long the dot lasts. Drop down a dimension and it works the same way: a flat shape crossing a line leaves a line segment. That's the 2D row in steps 4 to 6.",
  },
  sphere: {
    dims: 3, noun: "sphere", analogs: [],
    title: "A sphere passes through a wall",
    text: "Picture someone who lives on the wall and can only see along it. As the ball passes through, they never see the ball. They see a dot appear, grow into a circle, shrink, and vanish.",
  },
  cube: {
    dims: 3, noun: "cube", analogs: [],
    title: "A cube passes through a wall",
    text: "Pushed straight through, a cube leaves the same square on the wall the whole way. Tilt it and the wall sees other shapes: rectangles, or a triangle that grows into a hexagon when a corner leads.",
  },
  hypersphere: {
    dims: 4, noun: "hypersphere", analogs: ["circle", "sphere"],
    title: "A hypersphere passes through our space",
    text: "Now go up one dimension. A ball is a stack of circles along Z; a 4D ball is a stack of spheres along W. Passing through our space it would look like a point that swells into a sphere, then shrinks away.",
  },
  tesseract: {
    dims: 4, noun: "tesseract", analogs: ["square", "cube"],
    title: "A tesseract passes through our space",
    text: "A cube is a square stretched along Z; a tesseract is a cube stretched along W. Straight on, every slice is the same cube. The famous cube-inside-a-cube picture is the tesseract's shadow, not a slice; its slices never shrink. Tilt it in 4D and the slices become boxes, tetrahedra and octahedra, which is what the explorer above shows.",
  },
  pyramid: {
    dims: 3, noun: "square pyramid", analogs: [],
    title: "", text: "",
  },
  circle: {
    dims: 2, noun: "circle", analogs: [],
    title: "", text: "",
  },
  square: {
    dims: 2, noun: "square", analogs: [],
    title: "", text: "",
  },
  triangle: {
    dims: 2, noun: "triangle", analogs: [],
    title: "", text: "",
  },
  "cube-pyramid": {
    dims: 4, noun: "cube pyramid", analogs: ["triangle", "pyramid"],
    title: "A cube pyramid passes through our space",
    text: "For a cube that really does shrink, build a pyramid on one. A square pyramid joins every corner of a square to a point above it. A cube pyramid joins every corner of a cube to a point one step along W. Base first, our space sees a full cube appear, shrink evenly to a point, and vanish. Two dimensions down it's a triangle crossing a line: a line segment that shrinks to a point.",
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
  // A flat slice is drawn from its points in order, which only its face has.
  const points = result.dimension === 2 ? faces[0].points : result.points;
  return { points, faces, dimension: result.dimension, name: titleCase(name) };
}

/** A pyramid's base sits at -1 and its apex at +1, so the slice at `position` has this half-width. */
const pyramidHalf = (position: number): number => (1 - position) / 2;

/** Slices of a pyramid on a segment (a triangle), a square, or a cube, by the base's dimension. */
function pyramidSection(position: number, base: 1 | 2 | 3): Section {
  if (Math.abs(position) > 1 + epsilon) return empty();
  const half = pyramidHalf(position);
  if (half < 1e-3) return { points: [[0, 0, 0]], faces: [], dimension: 0, name: "Point" };
  const side = (2 * half).toFixed(2);
  if (base === 1) return { points: [[-half, 0, 0], [half, 0, 0]], faces: [], dimension: 1, name: "Line · length " + side };
  if (base === 3) {
    const faces = cubeFaces.map(({ points, normal }) => ({ points: points.map(point => point.map(value => value * half)), normal }));
    return { points: cubeVertices.map(vertex => vertex.map(value => value * half)), faces, dimension: 3, name: "Cube · side " + side };
  }
  const points = [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0]];
  return { points, faces: [{ points, normal: [0, 0, 1] }], dimension: 2, name: "Square · side " + side };
}

/** Slices of a circle or a turned square along Y: line segments along X. */
function segmentSection(xs: number[]): Section {
  if (xs.length === 0) return empty();
  const [low, high] = [Math.min(...xs), Math.max(...xs)];
  if (high - low < 1e-3) return { points: [[(low + high) / 2, 0, 0]], faces: [], dimension: 0, name: "Point" };
  return { points: [[low, 0, 0], [high, 0, 0]], faces: [], dimension: 1, name: "Line · length " + (high - low).toFixed(2) };
}

function circleLine(position: number): Section {
  const squared = 1 - position * position;
  if (squared < -epsilon) return empty();
  const half = Math.sqrt(Math.max(0, squared));
  return segmentSection([-half, half]);
}

const squareCorners = (tilt: Tilt): Vector[] =>
  [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]].map(corner => rotate3(corner, [[0, 1, squareTilts[tilt]]]));

function squareLine(tilt: Tilt, position: number): Section {
  const corners = squareCorners(tilt);
  const xs: number[] = [];
  corners.forEach((a, index) => {
    const b = corners[(index + 1) % 4];
    const da = a[1] - position, db = b[1] - position;
    if (Math.abs(da) < epsilon) xs.push(a[0]);
    if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) xs.push(a[0] + da / (da - db) * (b[0] - a[0]));
  });
  return segmentSection(xs);
}

function lineSection(position: number): Section {
  return Math.abs(position) > 1 + epsilon ? empty() : { points: [[0, 0, 0]], faces: [], dimension: 0, name: "Point" };
}

function extentOf(step: StepId, tilt: Tilt): number {
  if (step === "square") return Math.max(...squareCorners(tilt).map(corner => corner[1]));
  if (step !== "cube" && step !== "tesseract") return 1;
  if (step === "cube") return Math.max(...cubeVertices.map(vertex => rotate3(vertex, cubeTilts[tilt])[2]));
  return slice(tesseractTilts[tilt], 0).extent;
}

function sectionOf(step: StepId, tilt: Tilt, position: number): Section {
  switch (step) {
    case "line": return lineSection(position);
    case "sphere": return circleSection(position);
    case "cube": return squareSection(tilt, position);
    case "hypersphere": return ballSection(position);
    case "tesseract": return tesseractSection(tilt, position);
    case "circle": return circleLine(position);
    case "square": return squareLine(tilt, position);
    case "triangle": return pyramidSection(position, 1);
    case "pyramid": return pyramidSection(position, 2);
    case "cube-pyramid": return pyramidSection(position, 3);
  }
}

/** What each shape's slices are, for the row labels. Cubes' slices depend on the tilt. */
function slicesOf(step: StepId, tilt: Tilt): string {
  switch (step) {
    case "line": return "points";
    case "circle": case "square": case "triangle": return "lines";
    case "sphere": return "circles";
    case "pyramid": return "squares";
    case "hypersphere": return "spheres";
    case "cube-pyramid": return "cubes";
    case "cube": return { straight: "squares", tilted: "rectangles", corner: "triangles → hexagons" }[tilt];
    case "tesseract": return { straight: "cubes", tilted: "boxes", corner: "tetrahedra → octahedra" }[tilt];
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
    return `<path d="M${xy(screen[0])}L${xy(screen[1])}" stroke="${flatStroke}" stroke-width="3.6" stroke-linecap="round"/>`;
  }
  return screen.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${flatStroke}"/>`).join("");
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

// Half-width and half-height. Just big enough that a cube at any tilt (up to about
// 1.4 from its centre across the wall) sits inside it with a little margin.
const wallSize = [2.8, 1.9];
// The outside view draws a larger wall so it fills the view around the shape. The
// scene is still sized from `wallSize`, so the shape stays the same size on screen.
const outsideWallSize = [3.6, 2.5];

/** Grid lines every half unit across the wall, drawn through `at`. */
function wallGrid(at: (point: Vector) => string, [w, h]: number[]): string {
  const lines: string[] = [];
  for (let x = -Math.floor(w * 2) / 2; x <= w - 0.01; x += 0.5) lines.push(`M${at([x, -h, 0])}L${at([x, h, 0])}`);
  for (let y = -Math.floor(h * 2) / 2; y <= h - 0.01; y += 0.5) lines.push(`M${at([-w, y, 0])}L${at([w, y, 0])}`);
  return `<path d="${lines.join("")}" stroke="#48b2ac" stroke-opacity="0.16" stroke-width="1"/>`;
}

/** Matches the stylesheet's phone breakpoint. */
const phoneLayout = matchMedia("(max-width: 700px)");

/**
 * Sizes the scene from the wall as seen by the starting camera, then moves in closer
 * so the shape fills more of the view; the wall's far edges run past the frame.
 * It uses the starting camera rather than the current one so dragging doesn't zoom.
 */
function wallSceneScale(box: Box): number {
  const orient = orientFor(defaultCameras.scene);
  const [w, h] = wallSize;
  const corners = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(orient);
  const across = Math.max(...corners.map(([x]) => Math.abs(x)));
  const down = Math.max(...corners.map(([, y]) => Math.abs(y)));
  const closer = 1.05;
  return closer * Math.min(box.w / (2 * across), box.h / (2 * down));
}

function wallScene(box: Box, step: StepId, tilt: Tilt, position: number, section: Section, camera: Camera): string {
  const projector: Projector = {
    orient: orientFor(camera),
    cx: box.x + box.w / 2,
    // A little above centre so the shape sits higher, except on phones, where the
    // shorter pane would push it up behind the pane title.
    cy: box.y + box.h * (phoneLayout.matches ? 0.5 : 0.4),
    scale: wallSceneScale(box),
  };
  const at = (point: Vector) => xy(toScreen(projector, point));
  // The object sits at -position along Z, so the wall (z = 0) cuts it at `position`.
  const shift = (point: Vector): Vector => [point[0], point[1], point[2] - position];
  const round = step === "sphere";
  const polys: Poly[] = step === "line" ? [] : round
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
  // The line runs along Z from -1 to 1, so in the scene it spans these depths.
  const rod = (from: number, to: number) => from < to
    ? `<path d="M${at([0, 0, from])}L${at([0, 0, to])}" stroke="#c4bdb3" stroke-width="4" stroke-linecap="round"/>`
    : "";
  const [near, far] = [-1 - position, 1 - position];
  const [w, h] = outsideWallSize;
  const parts: string[] = [];
  parts.push(`<path d="M${at([0, 0, -2.9])}L${at([0, 0, 0])}" stroke="#8a837a" stroke-dasharray="3 5" stroke-width="1"/>`);
  parts.push(solid(back, projector, style));
  if (step === "line") parts.push(rod(near, Math.min(far, 0)));
  parts.push(`<polygon points="${[[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(at).join(" ")}" fill="#25302f" fill-opacity="0.8" stroke="#76c5c1" stroke-width="1.3" stroke-linejoin="round"/>`);
  parts.push(wallGrid(at, outsideWallSize));
  // The wall's corners run off-frame, so label a spot below and right of the shape.
  const [lx, ly] = toScreen(projector, [1.25, -1.7, 0]);
  parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#76c5c1" font-size="9.5" font-family="ui-monospace, monospace" letter-spacing="1.2">THE WALL</text>`);
  parts.push(sectionSvg(section, projector));
  parts.push(`<path d="M${at([0, 0, 0])}L${at([0, 0, 2.9])}" stroke="#8a837a" stroke-dasharray="3 5" stroke-width="1"/>`);
  // The part in front of the wall is see-through so the slice behind it stays visible.
  parts.push(`<g opacity="0.5">${solid(front, projector, style)}</g>`);
  if (step === "line") parts.push(rod(Math.max(near, 0), far));
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
  return `<polygon points="${[[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(at).join(" ")}" fill="#25302f" stroke="#76c5c1" stroke-width="1.3"/>`
    + wallGrid(at, wallSize)
    + sectionSvg(section, projector);
}

interface StripOptions {
  extent: number;
  position: number;
  axis: string;
  label: string;
  /** Used instead of `label` when the row is too narrow for it. */
  shortLabel: string;
  at: (position: number) => Section;
  camera?: Camera; // Flat slices are drawn face on; solid ones through this camera.
}

/** Lays a shape out along its slicing axis as a row of slices, with the live one marked. */
function strip(box: Box, { extent, position, axis, label, shortLabel, at, camera }: StripOptions): string {
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
  parts.push(`<text x="${box.x + pad}" y="${box.y + 16}" fill="#b0a89e" font-size="10" font-family="ui-monospace, monospace" letter-spacing="0.6">${label.length * 6.7 > box.w - 2 * pad ? shortLabel : label}</text>`);
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

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing primer element");
  return value;
}

function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing element: #" + id);
  return element as Element as T;
}

const signed = (value: number): string => {
  const rounded = Number(value.toFixed(2));
  return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + Math.abs(rounded).toFixed(2);
};

const defaultCameras: Record<"scene" | "solid", Camera> = {
  scene: { yaw: -0.82, pitch: 0.3 },
  solid: { yaw: -0.55, pitch: 0.42 },
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
  const outsideReset = required(root.querySelector<HTMLButtonElement>("[data-reset=outside]"));
  const insideReset = required(root.querySelector<HTMLButtonElement>("[data-reset=inside]"));
  const viewer = byId("primer-viewer");
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
    scene: { ...defaultCameras.scene },
    solid: { ...defaultCameras.solid },
  };
  const size = new Map<SVGSVGElement, [number, number]>();
  let frame = 0;

  // On phones in full screen the steps scroll sideways; keep the current one in sight.
  function revealStep(): void {
    if (!viewer.classList.contains("is-full")) return;
    stepButtons.find(button => button.dataset.step === state.step)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

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
        // Up close the wall runs past the scene's edges, so clip it above the row of slices.
        outsideShape.innerHTML = `<clipPath id="primer-scene-clip"><rect width="${ow}" height="${oh - stripHeight}"/></clipPath>`
          + `<g clip-path="url(#primer-scene-clip)">`
          + wallScene({ x: 0, y: head, w: ow, h: oh - stripHeight - head }, step, tilt, position, section, state.scene)
          + `</g>`
          + `<path d="M0,${oh - stripHeight}H${ow}" stroke="#4a4540"/>`
          + strip({ x: 0, y: oh - stripHeight, w: ow, h: stripHeight }, {
            extent, position, axis: "Z", label: `EVERY SLICE OF THE ${config.noun} (${slicesOf(step, tilt)}), LAID OUT ALONG Z`.toUpperCase(),
            shortLabel: `THE ${config.noun} (${slicesOf(step, tilt)}) ALONG Z`.toUpperCase(),
            at: value => sectionOf(step, tilt, value),
          });
      } else {
        // 4D can't be drawn whole, so show it and its lower-dimension cousins as rows of slices.
        const rows = [...config.analogs, step];
        const axes: Record<number, string> = { 2: "Y", 3: "Z", 4: "W" };
        const weight = (id: StepId) => [0, 0, 0.75, 1, 1.6][steps[id].dims];
        const total = rows.reduce((sum, id) => sum + weight(id), 0);
        let y = 64;
        outsideShape.innerHTML = rows.map((id, index) => {
          const rowExtent = extentOf(id, tilt);
          const dims = steps[id].dims;
          const height = (oh - 64) * weight(id) / total;
          const row = (index ? `<path d="M18,${y}H${ow - 18}" stroke="#4a4540" stroke-dasharray="2 4"/>` : "")
            + strip({ x: 0, y: y + (index ? 4 : 0), w: ow, h: height - (index ? 4 : 0) }, {
              extent: rowExtent, position: state.t * rowExtent, axis: axes[dims],
              label: `${dims}D · A ${steps[id].noun} IS A STACK OF SLICES (${slicesOf(id, tilt)}) ALONG ${axes[dims]}`.toUpperCase(),
              shortLabel: `${dims}D · ${steps[id].noun} (${slicesOf(id, tilt)}) ALONG ${axes[dims]}`.toUpperCase(),
              at: value => sectionOf(id, tilt, value), camera: dims === 4 ? state.solid : undefined,
            });
          y += height;
          return row;
        }).join("");
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
      : `Every slice of ${[...config.analogs.map(id => "a " + steps[id].noun), "a " + noun].join(", then ")}, each laid out in a row, marked at ${coordinate}.`);
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
    tiltGroup.hidden = state.step !== "cube" && state.step !== "tesseract";
    exploreButton.hidden = state.step !== "tesseract";
    byId("primer-step-title").textContent = config.title;
    byId("primer-step-text").textContent = config.text;
    byId("primer-outside-title").textContent = config.dims === 3 ? `The ${config.noun} and the wall` : "Too big to draw whole, so lay it out";
    byId("primer-inside-title").textContent = config.dims === 3 ? "What the wall sees" : "What we see in 3D";
    inside.classList.toggle("draggable", config.dims === 4);
    // The flat wall view has no camera, so it has nothing to reset.
    insideReset.hidden = config.dims === 3;
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
      revealStep();
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
    exitFullscreen();
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

  // Full screen works like the explorer's: the Fullscreen API where the browser
  // allows it on an element, otherwise the section is stretched over the page.
  const fullscreenButton = byId<HTMLButtonElement>("primer-fullscreen");
  const isFullscreen = () => document.fullscreenElement === viewer || viewer.classList.contains("expanded");
  function syncFullscreen(): void {
    const on = isFullscreen();
    viewer.classList.toggle("is-full", on);
    revealStep();
    fullscreenButton.setAttribute("aria-pressed", String(on));
    fullscreenButton.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    fullscreenButton.title = (on ? "Exit full screen" : "Full screen") + " (F)";
  }
  function setExpanded(on: boolean): void {
    viewer.classList.toggle("expanded", on);
    document.body.classList.toggle("viewer-expanded", on);
    syncFullscreen();
  }
  function toggleFullscreen(): void {
    if (document.fullscreenElement === viewer) void document.exitFullscreen();
    else if (viewer.classList.contains("expanded")) setExpanded(false);
    else if (document.fullscreenEnabled) viewer.requestFullscreen().catch(() => setExpanded(true));
    else setExpanded(true);
  }
  function exitFullscreen(): void {
    if (document.fullscreenElement === viewer) void document.exitFullscreen();
    if (viewer.classList.contains("expanded")) setExpanded(false);
  }
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && viewer.classList.contains("expanded")) setExpanded(false);
  });
  viewer.addEventListener("keydown", event => {
    if (event.key !== "f" && event.key !== "F") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    toggleFullscreen();
    event.preventDefault();
  });
  // Outside resets whichever camera that pane uses; inside always uses the solid camera.
  outsideReset.addEventListener("click", () => {
    if (steps[state.step].dims === 3) Object.assign(state.scene, defaultCameras.scene);
    else Object.assign(state.solid, defaultCameras.solid);
    schedule();
  });
  insideReset.addEventListener("click", () => {
    Object.assign(state.solid, defaultCameras.solid);
    schedule();
  });

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
