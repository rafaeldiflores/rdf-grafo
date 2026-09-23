// d3-force-3d (dependencia de 3d-force-graph) no publica tipos; solo se usan
// las fuerzas de posición (centrar nodos sueltos) y de colisión.
declare module 'd3-force-3d' {
  interface PositionForce {
    strength(s: number): PositionForce;
  }
  export function forceX(x?: number): PositionForce;
  export function forceY(y?: number): PositionForce;
  export function forceZ(z?: number): PositionForce;
  interface CollideForce {
    strength(s: number): CollideForce;
  }
  export function forceCollide<N>(radius: (n: N) => number): CollideForce;
}
