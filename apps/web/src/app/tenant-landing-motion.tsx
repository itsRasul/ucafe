"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function TenantLandingMotion() {
  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".tenant-nav", { opacity: 0, duration: 0.8, ease: "power3.out" });
        gsap.from(".tenant-hero-copy > *", {
          y: 42,
          opacity: 0,
          duration: 0.9,
          stagger: 0.1,
          ease: "power4.out",
        });
        gsap.from(".tenant-hero-photo", { scale: 1.08, opacity: 0.45, duration: 1.5, ease: "power3.out" });
        gsap.to(".tenant-hero-photo img", {
          yPercent: 8,
          scale: 1.1,
          ease: "none",
          scrollTrigger: { trigger: ".tenant-hero", start: "top top", end: "bottom top", scrub: 0.7 },
        });

        gsap.utils.toArray<HTMLElement>(".reveal").forEach((element) => {
          ScrollTrigger.create({
            trigger: element,
            start: "top 88%",
            once: true,
            onEnter: () => element.classList.add("is-visible"),
          });
        });
      });

      return () => media.revert();
    },
    [],
  );

  return null;
}
