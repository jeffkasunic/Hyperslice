// Shape naming for slices.
import { dot, length, mul, sub, type Face, type Slice, type Vector } from "./geometry";

// Names a slice from its actual geometry: the mix of face types, checked
// against metric tests so "prism" or "cube" is only claimed when it is true.
const shapeTolerance = 1e-6;
const polygonNames: Partial<Record<number, string>> = { 3: "triangle", 4: "quadrilateral", 5: "pentagon", 6: "hexagon" };
const prismNames: Record<number, string> = { 3: "triangular", 5: "pentagonal", 6: "hexagonal" };
/** Face signature (count x sides) of each prism, mapped to its cap's side count. */
const prismCaps: Partial<Record<string, number>> = { "2x3 3x4": 3, "5x4 2x5": 5, "6x4 2x6": 6 };

type QuadKind = "quadrilateral" | "parallelogram" | "rectangle" | "square";

function sameLength(lengths: number[]): boolean {
  const longest = Math.max(...lengths);
  return longest - Math.min(...lengths) < shapeTolerance * longest;
}

function quadKind(indices: number[], points: Vector[]): QuadKind {
  const corners = indices.map(index => points[index]);
  const sides = corners.map((corner, i) => sub(corners[(i + 1) % 4], corner));
  const sideLengths = sides.map(length);
  const scale = Math.max(...sideLengths);
  const parallelogram = length(sub(sides[0], mul(sides[2], -1))) < shapeTolerance * scale
    && length(sub(sides[1], mul(sides[3], -1))) < shapeTolerance * scale;
  if (!parallelogram) return "quadrilateral";
  const right = Math.abs(dot(sides[0], sides[1])) < shapeTolerance * scale * scale;
  if (!right) return "parallelogram";
  return sameLength(sideLengths) ? "square" : "rectangle";
}

// True prism: two disjoint n-gon caps where one is a translated copy of the other.
function isPrism(faces: Face[], points: Vector[], sides: number): boolean {
  const caps = faces.filter(face => face.indices.length === sides);
  return caps.some((first, i) => caps.slice(i + 1).some(second => {
    if (first.indices.some(index => second.indices.includes(index))) return false;
    // Cap vertices are ordered by angle, so try each vertex as the partner of the first.
    return second.indices.some(partner => {
      const shift = sub(points[partner], points[first.indices[0]]);
      const scale = length(shift);
      return first.indices.every(a => second.indices.some(b =>
        length(sub(sub(points[b], points[a]), shift)) < shapeTolerance * scale
      ));
    });
  }));
}

export function shapeName({ points, faces, dimension }: Pick<Slice, "points" | "faces" | "dimension">): string {
  if (points.length === 0) return "Empty slice";
  if (dimension === 0) return "Point slice";
  if (dimension === 1) return "Line slice";
  if (dimension === 2) {
    const kind = points.length === 4 ? quadKind(faces[0].indices, points) : polygonNames[points.length];
    return "Flat " + (kind ?? points.length + "-sided polygon");
  }

  const tally: Record<string, number> = {};
  for (const { indices } of faces) tally[indices.length] = (tally[indices.length] ?? 0) + 1;
  const signature = Object.keys(tally)
    .sort((a, b) => Number(a) - Number(b))
    .map(sides => tally[sides] + "x" + sides)
    .join(" ");
  const edgeLengths = faces.flatMap(({ indices }) =>
    indices.map((index, i) => length(sub(points[indices[(i + 1) % indices.length]], points[index])))
  );

  switch (signature) {
    case "4x3":
      return "Tetrahedron";
    case "8x3":
      return sameLength(edgeLengths) ? "Regular octahedron" : "Irregular octahedron";
    case "4x3 4x6":
      return "Truncated tetrahedron";
    case "6x4": {
      const kinds = faces.map(({ indices }) => quadKind(indices, points));
      if (kinds.every(kind => kind === "square")) return "Cube";
      if (kinds.every(kind => kind === "square" || kind === "rectangle")) return "Rectangular box";
      if (kinds.every(kind => kind !== "quadrilateral")) return "Parallelepiped";
      return "Irregular hexahedron";
    }
  }
  const capSides = prismCaps[signature];
  if (capSides !== undefined) {
    const name = prismNames[capSides] + " prism";
    return isPrism(faces, points, capSides) ? name[0].toUpperCase() + name.slice(1) : "Irregular " + name;
  }
  return faces.length + "-faced polyhedron";
}
