"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// -----------------------------------------------------------------------------
// A normalized-performance chart rendered in real 3D. Each series becomes a
// tube swept along its price curve, parked at its own depth (z) so the lines
// separate visually instead of overlapping, with an additive "wall" dropping to
// the 0% plane and a glowing head at the latest point. The plot drifts gently
// and parallaxes with the pointer; on data change the tubes draw themselves in
// left-to-right via an animated geometry draw-range.
//
// Deliberately fiber + three only (no drei): the axis labels live in a plain
// HTML overlay in the parent, and the idle rotation is kept subtle enough that
// they stay aligned. Fewer moving parts, nothing to fetch at runtime.
// -----------------------------------------------------------------------------

export interface ChartLine {
  ticker: string;
  points: { date: string; value: number }[];
}

const PLOT_W = 11; // x extent: -5.5 .. 5.5
const PLOT_H = 4.4; // y extent: -2.2 .. 2.2
const Z_STEP = 1.15; // depth between adjacent series
const DRAW_SECONDS = 0.85;

const xFor = (i: number, n: number) => -PLOT_W / 2 + (i / Math.max(1, n - 1)) * PLOT_W;
const yFor = (value: number, low: number, high: number) =>
  -PLOT_H / 2 + ((value - low) / Math.max(1e-6, high - low)) * PLOT_H;

/** Thin emissive bar used for grid lines — a box mesh keeps this dependency-free. */
function Bar({
  position, length, color, opacity = 1, axis = "x", thickness = 0.008,
}: {
  position: [number, number, number];
  length: number;
  color: string;
  opacity?: number;
  axis?: "x" | "z";
  thickness?: number;
}) {
  const args: [number, number, number] =
    axis === "x" ? [length, thickness, thickness] : [thickness, thickness, length];
  return (
    <mesh position={position}>
      <boxGeometry args={args} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Text baked to a canvas texture. Drawn on a sprite it billboards toward the
 *  camera, so labels stay upright and legible at any orbit angle — and unlike a
 *  3D text mesh there is no font file to fetch at runtime. */
function makeLabelTexture(text: string, color: string, align: "left" | "right"): THREE.CanvasTexture {
  const W = 256, H = 64, DPR = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);
  ctx.font = "600 30px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, align === "right" ? W - 6 : 6, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function Label({
  text, position, color = "#8b97a4", align = "right", scale = 1,
}: {
  text: string;
  position: [number, number, number];
  color?: string;
  align?: "left" | "right";
  scale?: number;
}) {
  const tex = useMemo(() => makeLabelTexture(text, color, align), [text, color, align]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[1.7 * scale, 0.425 * scale, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  );
}

/** One series: tube along the curve + additive wall down to the zero plane.
 *  Memoised on a primitive signature so unrelated parent re-renders (the 1s
 *  market clock, hover state) never rebuild GPU geometry. */
const SeriesTube = memo(function SeriesTube({
  line, color, z, low, high, zeroY, dimmed, sig,
}: {
  line: ChartLine;
  color: string;
  z: number;
  low: number;
  high: number;
  zeroY: number;
  dimmed: boolean;
  sig: string;
}) {
  const tubeRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);

  const { tubeGeo, wallGeo, headPos } = useMemo(() => {
    const n = line.points.length;
    const vecs = line.points.map((p, i) => new THREE.Vector3(xFor(i, n), yFor(p.value, low, high), 0));
    if (vecs.length < 2) vecs.push(new THREE.Vector3(0, zeroY, 0));

    const curve = new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.35);
    // Keep the triangle budget modest — this is a 300px-tall panel, not a hero.
    const segments = Math.min(200, Math.max(24, n * 2));
    const tube = new THREE.TubeGeometry(curve, segments, 0.055, 6, false);

    // Wall: two vertices per sample (curve point + its projection on 0%).
    const positions = new Float32Array(vecs.length * 2 * 3);
    vecs.forEach((v, i) => {
      positions.set([v.x, v.y, 0], i * 6);
      positions.set([v.x, zeroY, 0], i * 6 + 3);
    });
    const indices: number[] = [];
    for (let i = 0; i < vecs.length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    const wall = new THREE.BufferGeometry();
    wall.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    wall.setIndex(indices);

    return { tubeGeo: tube, wallGeo: wall, headPos: vecs[vecs.length - 1] };
    // `sig` is a primitive stand-in for the (object-identity-unstable) line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, low, high, zeroY]);

  // Rebuild -> replay the draw-in animation.
  useEffect(() => {
    progress.current = 0;
    return () => {
      tubeGeo.dispose();
      wallGeo.dispose();
    };
  }, [tubeGeo, wallGeo]);

  useFrame((_, delta) => {
    if (progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + delta / DRAW_SECONDS);
    // Ease-out so the line settles rather than stopping dead.
    const eased = 1 - Math.pow(1 - progress.current, 3);
    tubeGeo.setDrawRange(0, Math.floor((tubeGeo.index?.count ?? 0) * eased));
  });

  const opacity = dimmed ? 0.3 : 1;
  return (
    <group position={[0, 0, z]}>
      {/* Core line: unlit basic material so the accent colour stays vivid
          regardless of scene lighting. */}
      <mesh ref={tubeRef} geometry={tubeGeo} renderOrder={2}>
        <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
      </mesh>
      <mesh geometry={wallGeo}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={dimmed ? 0.04 : 0.11}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Glowing head at the latest point. */}
      <mesh position={headPos}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={headPos}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={dimmed ? 0.06 : 0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Ticker rides with its own line, so the series stay identifiable
          however far the view is orbited. */}
      {!dimmed && (
        <Label
          text={line.ticker}
          position={[headPos.x + 1.05, headPos.y + 0.28, 0]}
          color={color}
          align="left"
          scale={0.8}
        />
      )}
    </group>
  );
});

function Scene({
  lines, colors, low, high, ticks, hoverRatio, focus,
}: {
  lines: ChartLine[];
  colors: readonly string[];
  low: number;
  high: number;
  ticks: number[];
  hoverRatio: number | null;
  focus: string | null;
}) {
  const zeroY = yFor(0, low, high);
  const depth = ((lines.length - 1) / 2) * Z_STEP;
  // The scene itself stays still — the user drives the view via OrbitControls,
  // and a drifting scene under an orbiting camera reads as motion sickness.
  const backZ = -depth - 0.9;

  return (
    <group>
      <ambientLight intensity={0.65} />
      <directionalLight position={[4, 6, 6]} intensity={1.1} />
      <pointLight position={[-5, 2, 4]} intensity={22} distance={22} color="#7dd3fc" />

      {/* Back wall: one bar per tick level. */}
      {ticks.map((value) => (
        <Bar
          key={`t${value}`}
          position={[0, yFor(value, low, high), backZ]}
          length={PLOT_W}
          color={Math.abs(value) < 1e-9 ? "#6b7783" : "#2b333d"}
          opacity={Math.abs(value) < 1e-9 ? 0.75 : 0.5}
        />
      ))}

      {/* Zero plane running through the depth of the stack. */}
      <Bar position={[0, zeroY, 0]} length={PLOT_W} color="#8b97a4" opacity={0.35} />

      {/* Axis scale lives in the scene (billboarded), so it stays attached to
          its gridline no matter how the view is orbited. */}
      {ticks.map((value) => (
        <Label
          key={`lbl${value}`}
          // Centre depth, just outside the plot edge: keeps the scale inside the
          // frustum at every orbit angle (parked at the back wall it swung out
          // of frame once rotated).
          position={[-PLOT_W / 2 - 0.75, yFor(value, low, high), 0]}
          text={`${value.toFixed(1)}%`}
          color={Math.abs(value) < 1e-9 ? "#c3ccd6" : "#8b97a4"}
          scale={0.8}
        />
      ))}

      {/* Floor grid: rails running into the screen plus cross-ties. Together
          they give the eye the perspective cue that sells the depth. */}
      {Array.from({ length: 9 }).map((_, i) => (
        <Bar
          key={`f${i}`}
          position={[-PLOT_W / 2 + (i / 8) * PLOT_W, -PLOT_H / 2 - 0.5, backZ / 2 + 0.8]}
          length={Math.abs(backZ) + 2.4}
          axis="z"
          color="#3a4550"
          opacity={0.55}
        />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <Bar
          key={`fz${i}`}
          position={[0, -PLOT_H / 2 - 0.5, backZ + 0.4 + (i / 4) * (Math.abs(backZ) + 2)]}
          length={PLOT_W}
          color="#3a4550"
          opacity={0.4}
        />
      ))}

      {/* Hover scan plane. */}
      {hoverRatio !== null && (
        <mesh position={[-PLOT_W / 2 + hoverRatio * PLOT_W, 0, 0]}>
          <planeGeometry args={[0.02, PLOT_H + 0.7]} />
          <meshBasicMaterial color="#d9e1e8" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {lines.map((line, i) => (
        <SeriesTube
          key={line.ticker}
          line={line}
          sig={`${line.ticker}|${line.points.length}|${line.points[line.points.length - 1]?.value ?? 0}`}
          color={colors[i % colors.length]}
          z={(i - (lines.length - 1) / 2) * Z_STEP}
          low={low}
          high={high}
          zeroY={zeroY}
          dimmed={Boolean(focus) && focus !== line.ticker}
        />
      ))}
    </group>
  );
}

export default memo(function PerformanceChart3D(props: {
  lines: ChartLine[];
  colors: readonly string[];
  low: number;
  high: number;
  ticks: number[];
  hoverRatio: number | null;
  focus: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={hostRef} className="absolute inset-0">
      <Canvas
        style={{ width: "100%", height: "100%" }}
        resize={{ debounce: 0 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 2.6, 9.2], fov: 42 }}
        onCreated={({ camera, gl }) => {
          // fiber only sets camera position; aim it at the plot centre.
          camera.lookAt(0, 0, 0);
          // The canvas is lazy-loaded into an already-sized box, so r3f can latch
          // onto three's default 300x150 and never correct. Size it from the real
          // host rect once at creation.
          const r = hostRef.current?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            gl.setSize(r.width, r.height);
            const cam = camera as THREE.PerspectiveCamera;
            cam.aspect = r.width / r.height;
            cam.updateProjectionMatrix();
          }
        }}
      >
        <Scene {...props} />
        {/* Drag to orbit. Pan is off and the angles/zoom are clamped so the
            plot can be inspected from any useful angle but never lost. */}
        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.6}
          zoomSpeed={0.6}
          minDistance={5.5}
          maxDistance={14}
          minPolarAngle={Math.PI * 0.18}
          maxPolarAngle={Math.PI * 0.62}
          minAzimuthAngle={-Math.PI * 0.42}
          maxAzimuthAngle={Math.PI * 0.42}
        />
      </Canvas>
    </div>
  );
});
