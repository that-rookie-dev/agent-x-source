/// <reference types="vite/client" />

// three@0.160 in this workspace ships no bundled type declarations and
// @types/three is not installed. Declare the minimal surface we actually use
// so our own code stays type-checked without pulling a new dependency.
declare module 'three' {
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
  }
  export class Object3D {
    position: { set(x: number, y: number, z: number): void };
    scale: { setScalar(n: number): void };
    add(object: Object3D): void;
    fog: unknown;
  }
  export class Scene extends Object3D {}
  export class Mesh extends Object3D {
    constructor(geometry?: unknown, material?: unknown);
  }
  export class SphereGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  export class MeshBasicMaterial {
    constructor(params?: { color?: string | number; transparent?: boolean; opacity?: number });
    color: unknown;
    opacity: number;
  }
  export class AmbientLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }
  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }
  export class FogExp2 {
    constructor(color?: number, density?: number);
  }
}

// Three.js example modules ship without type declarations in this version.
declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js' {
  import { Vector2 } from 'three';
  export class UnrealBloomPass {
    constructor(resolution?: Vector2, strength?: number, radius?: number, threshold?: number);
    strength: number;
    radius: number;
    threshold: number;
    resolution: Vector2;
    enabled: boolean;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}

declare module 'three/examples/jsm/postprocessing/OutputPass.js' {
  export class OutputPass {
    constructor();
    enabled: boolean;
    dispose(): void;
  }
}
