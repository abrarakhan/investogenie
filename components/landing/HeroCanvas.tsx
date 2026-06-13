"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { useMarket } from "@/context/MarketProvider";

// -----------------------------------------------------------------------------
// MarketTerrain: a subdivided plane whose vertices are displaced every frame by
// layered sine fields plus a travelling "ripple" centred on the mouse, evoking a
// living topological surface of market data flows. Rendered as a wireframe.
// -----------------------------------------------------------------------------
const SEG = 56;
const SIZE = 16;

function MarketTerrain({ color }: { color: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  // Capture the pristine grid positions once so displacement is non-cumulative.
  const base = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    return Float32Array.from(g.attributes.position.array);
  }, []);

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const pos = m.geometry.attributes.position;
    // Pointer in NDC (-1..1); map onto the plane's local X/Y extent.
    const mx = state.pointer.x * (SIZE / 2);
    const my = state.pointer.y * (SIZE / 2);

    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      // Two travelling wave fields = baseline "market noise".
      let z =
        Math.sin(x * 0.6 + t * 0.9) * 0.45 +
        Math.cos(y * 0.5 - t * 0.6) * 0.4;
      // Mouse ripple: a localised gaussian-decayed swell following the cursor.
      const d = Math.hypot(x - mx, y - my);
      z += Math.cos(d * 1.1 - t * 3) * Math.exp(-d * 0.45) * 1.6;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.rotation.z += delta * 0.02; // slow sovereign drift
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2.2, 0, 0]} position={[0, -1.5, 0]}>
      <planeGeometry args={[SIZE, SIZE, SEG, SEG]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.55} />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Constellation: a floating particle field. Particles drift and are repelled by
// the mouse along the pointer vector, so the cloud parts as the cursor moves.
// -----------------------------------------------------------------------------
const COUNT = 700;

function Constellation({ color }: { color: string }) {
  const points = useRef<THREE.Points>(null);
  const base = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 18;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10 + 2;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return arr;
  }, []);

  useFrame((state) => {
    const p = points.current;
    if (!p) return;
    const t = state.clock.elapsedTime;
    const pos = p.geometry.attributes.position;
    const mx = state.pointer.x * 9;
    const my = state.pointer.y * 5 + 2;
    for (let i = 0; i < COUNT; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      // Gentle vertical bob.
      const fy = by + Math.sin(t * 0.6 + bx) * 0.25;
      // Mouse repulsion along the cursor→particle vector.
      const dx = bx - mx;
      const dy = fy - my;
      const dist = Math.hypot(dx, dy) + 0.0001;
      const force = Math.min(1.4, 2.2 / (dist * dist));
      pos.setXYZ(i, bx + (dx / dist) * force, fy + (dy / dist) * force, bz);
    }
    pos.needsUpdate = true;
    p.rotation.y = t * 0.03;
  });

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
    return g;
  }, [base]);

  const args: ThreeElements["points"] = { geometry };
  return (
    <points ref={points} {...args}>
      <pointsMaterial
        color={color}
        size={0.07}
        sizeAttenuation
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function HeroCanvas() {
  const { market } = useMarket();
  // Colours are passed as props because React context does not cross the R3F
  // renderer boundary; this keeps the scene reactive to the Sovereign Switch.
  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 2.5, 9], fov: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <fog attach="fog" args={["#05070d", 8, 22]} />
      <ambientLight intensity={0.6} />
      <MarketTerrain color={market.theme.primary} />
      <Constellation color={market.theme.accent} />
    </Canvas>
  );
}
