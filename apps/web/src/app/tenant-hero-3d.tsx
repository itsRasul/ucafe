"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";

function Cup() {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0.08, y: -0.35, progress: 0 });
  const { invalidate } = useThree();

  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".tenant-hero-track");
    const onScroll = () => {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      target.current.progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - innerHeight)));
      invalidate();
    };
    const onPointer = (event: PointerEvent) => {
      target.current.x = (event.clientY / innerHeight - 0.5) * 0.18;
      target.current.y = (event.clientX / innerWidth - 0.5) * 0.55;
      invalidate();
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("pointermove", onPointer, { passive: true });
    return () => { removeEventListener("scroll", onScroll); removeEventListener("pointermove", onPointer); };
  }, [invalidate]);

  useFrame(() => {
    if (!group.current) return;
    const progress = target.current.progress;
    group.current.rotation.x = target.current.x + progress * 0.18;
    group.current.rotation.y = target.current.y - 0.55 + progress * 1.45;
    group.current.position.y = -0.2 + progress * 0.45;
    group.current.scale.setScalar(1 + progress * 0.08);
  });

  return (
    <group ref={group} rotation={[0.08, -0.55, -0.05]}>
      <mesh position={[0, -1.03, 0]} receiveShadow>
        <cylinderGeometry args={[2.25, 2.5, 0.16, 72]} />
        <meshStandardMaterial color="#17100d" roughness={0.32} metalness={0.12} />
      </mesh>
      <mesh position={[0, -0.9, 0]} receiveShadow>
        <torusGeometry args={[1.55, 0.3, 28, 72]} />
        <meshStandardMaterial color="#241713" roughness={0.45} metalness={0.08} />
      </mesh>
      <mesh position={[0, -0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.45, 1.12, 1.72, 72, 1, true]} />
        <meshPhysicalMaterial color="#110d0c" roughness={0.24} metalness={0.08} clearcoat={0.72} clearcoatRoughness={0.2} side={2} />
      </mesh>
      <mesh position={[0, 0.84, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.28, 0.13, 24, 72]} />
        <meshPhysicalMaterial color="#2c1a14" roughness={0.2} metalness={0.18} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.77, 0]}>
        <cylinderGeometry args={[1.25, 1.25, 0.055, 72]} />
        <meshPhysicalMaterial color="#5b2410" roughness={0.12} metalness={0.02} clearcoat={1} />
      </mesh>
      <mesh position={[1.37, -0.08, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.68, 0.18, 24, 64, Math.PI * 1.72]} />
        <meshPhysicalMaterial color="#100c0b" roughness={0.25} clearcoat={0.7} />
      </mesh>
    </group>
  );
}

export function TenantHero3d() {
  return (
    <div className="tenant-hero-canvas" aria-hidden="true">
      <Canvas camera={{ position: [0, 0.35, 6.7], fov: 38 }} dpr={[1, 1.35]} frameloop="demand" gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }} shadows>
        <ambientLight intensity={0.38} color="#f1dfc4" />
        <directionalLight position={[-3, 5, 4]} color="#fff0d4" intensity={3.2} castShadow />
        <pointLight position={[4, 1, 3]} color="#cf633e" intensity={42} distance={8} />
        <pointLight position={[-4, -2, 2]} color="#6d2b18" intensity={18} distance={7} />
        <Cup />
      </Canvas>
      <span className="steam steam-one" /><span className="steam steam-two" /><span className="steam steam-three" />
    </div>
  );
}
