// Tesseract geometry: the 4D cube, plane rotations, and slicing it with W = offset.

/** A point or direction. Length 3 in slice space, 4 in tesseract space. */
export type Vector = number[];

export type PlaneName = "XW" | "YW" | "ZW" | "XY" | "XZ" | "YZ";

export interface Plane {
  name: PlaneName;
  /** The two coordinate axes the rotation mixes (0 = X … 3 = W). */
  axes: readonly [number, number];
  label: string;
}

export interface Face {
  /** Indices into `Slice.points`, ordered around the polygon. */
  indices: number[];
  /** Unit outward normal in slice space. */
  normal: Vector;
}

export interface Slice {
  points: Vector[];
  faces: Face[];
  edgeCount: number;
  /** 0 = point (or empty), 1 = line, 2 = flat polygon, 3 = solid. */
  dimension: 0 | 1 | 2 | 3;
  /** Largest W reached by any tesseract corner. */
  extent: number;
}

/** Rotation angles in degrees, one per entry of `planes`, in the same order. */
export type Angles = number[];

export const planes: readonly Plane[] = [
  { name: "XW", axes: [0, 3], label: "X with W" },
  { name: "YW", axes: [1, 3], label: "Y with W" },
  { name: "ZW", axes: [2, 3], label: "Z with W" },
  { name: "XY", axes: [0, 1], label: "X with Y" },
  { name: "XZ", axes: [0, 2], label: "X with Z" },
  { name: "YZ", axes: [1, 2], label: "Y with Z" },
];

const epsilon = 1e-8;
const vertices: Vector[] = Array.from({ length: 16 }, (_, index) =>
  Array.from({ length: 4 }, (_, axis) => (index & (1 << axis)) === 0 ? -1 : 1)
);
const edges: [number, number][] = vertices.flatMap((_, index) =>
  [1, 2, 4, 8].filter(bit => (index & bit) === 0).map((bit): [number, number] => [index, index | bit])
);

export const dot = (a: Vector, b: Vector): number => a.reduce((sum, value, index) => sum + value * b[index], 0);
export const sub = (a: Vector, b: Vector): Vector => a.map((value, index) => value - b[index]);
export const mul = (vector: Vector, scalar: number): Vector => vector.map(value => value * scalar);
export const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (vector: Vector): number => Math.hypot(...vector);

function polygon(indices: number[], normal: Vector, points: Vector[]): number[] {
  const center = [0, 1, 2].map(axis =>
    indices.reduce((sum, index) => sum + points[index][axis], 0) / indices.length
  );
  const u = sub(points[indices[0]], center);
  const v = cross(normal, u);
  return [...indices].sort((a, b) => {
    const pa = sub(points[a], center);
    const pb = sub(points[b], center);
    return Math.atan2(dot(pa, v), dot(pa, u)) - Math.atan2(dot(pb, v), dot(pb, u));
  });
}

export function slice(angles: Angles, offset: number): Slice {
  const rotations = planes.map(({ axes }, index) => {
    const radians = angles[index] * Math.PI / 180;
    return { axes, cosine: Math.cos(radians), sine: Math.sin(radians) };
  });
  function rotate(vector: Vector): Vector {
    const result = [...vector];
    for (const { axes: [a, b], cosine, sine } of rotations) {
      const first = result[a];
      const second = result[b];
      result[a] = cosine * first - sine * second;
      result[b] = sine * first + cosine * second;
    }
    return result;
  }

  const rotated = vertices.map(rotate);
  const basis = [0, 1, 2, 3].map(axis => rotate([0, 1, 2, 3].map(i => Number(i === axis))));
  const extent = Math.max(...rotated.map(point => point[3]));
  const points: Vector[] = [];
  function add(point: Vector): void {
    const xyz = point.slice(0, 3);
    if (!points.some(existing => length(sub(existing, xyz)) < epsilon)) points.push(xyz);
  }

  // Every section vertex lies on an original tesseract edge. Keep both endpoints
  // when the cutting plane contains the entire edge.
  for (const [first, second] of edges) {
    const a = rotated[first];
    const b = rotated[second];
    const da = a[3] - offset;
    const db = b[3] - offset;
    if (Math.abs(da) < epsilon) add(a);
    if (Math.abs(db) < epsilon) add(b);
    if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
      const t = da / (da - db);
      add(a.map((value, axis) => value + t * (b[axis] - value)));
    }
  }

  const result: Slice = { points, faces: [], edgeCount: 0, dimension: 0, extent };
  if (points.length < 2) return result;

  const direction = sub(points[1], points[0]);
  const directions = points.slice(2).map(point => sub(point, points[0]));
  const crossProducts = directions.map(vector => cross(direction, vector));
  const normal: Vector | undefined = crossProducts.sort((a, b) => length(b) - length(a))[0];
  if (!normal || length(normal) / length(direction) < epsilon) {
    result.dimension = 1;
    result.edgeCount = 1;
    return result;
  }
  const unitNormal = mul(normal, 1 / length(normal));
  if (!directions.some(vector => Math.abs(dot(unitNormal, vector)) > epsilon)) {
    result.dimension = 2;
    result.faces.push({ indices: polygon(points.map((_, i) => i), unitNormal, points), normal: unitNormal });
    result.edgeCount = points.length;
    return result;
  }

  // A face belongs to one of the eight bounding cells of the 4D cube. A
  // rotated basis vector is the corresponding pair of outward cell normals.
  result.dimension = 3;
  const found = new Set<string>();
  const foundEdges = new Set<string>();
  for (const cellAxis of basis) {
    const xyz = cellAxis.slice(0, 3);
    const magnitude = length(xyz);
    if (magnitude < epsilon) continue;
    for (const sign of [-1, 1]) {
      const indices = points.flatMap((point, index) =>
        Math.abs(dot(point, xyz) + offset * cellAxis[3] - sign) < epsilon ? [index] : []
      );
      if (indices.length < 3) continue;
      const key = indices.join(",");
      if (found.has(key)) continue;
      found.add(key);
      const faceNormal = mul(xyz, sign / magnitude);
      const ordered = polygon(indices, faceNormal, points);
      result.faces.push({ indices: ordered, normal: faceNormal });
      ordered.forEach((a, index) => {
        const b = ordered[(index + 1) % ordered.length];
        foundEdges.add(a < b ? a + "," + b : b + "," + a);
      });
    }
  }
  result.edgeCount = foundEdges.size;
  return result;
}
