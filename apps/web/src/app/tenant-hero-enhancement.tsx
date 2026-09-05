"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const CoffeeScene = dynamic(() => import("./tenant-hero-3d").then((module) => module.TenantHero3d), { ssr: false });

export function TenantHeroEnhancement() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    const canvas = document.createElement("canvas");
    setEnabled(!reduced && !saveData && Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")));
  }, []);
  return enabled ? <CoffeeScene /> : null;
}
