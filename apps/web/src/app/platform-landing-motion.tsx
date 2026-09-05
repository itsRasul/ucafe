"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function PlatformLandingMotion() {
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".platform-nav", { y: -24, opacity: 0, duration: 0.8, ease: "power3.out" });
      gsap.from(".platform-hero-copy > *", { y: 34, opacity: 0, duration: 0.85, stagger: 0.09, ease: "power4.out" });
      gsap.from(".hero-product", { y: 70, scale: 0.94, opacity: 0, duration: 1.1, delay: 0.25, ease: "power4.out" });

      const words = gsap.utils.toArray<HTMLElement>(".manifesto-word");
      gsap.fromTo(words, { opacity: 0.12 }, { opacity: 1, stagger: 0.08, ease: "none", scrollTrigger: { trigger: ".platform-manifesto", start: "top 78%", end: "bottom 58%", scrub: 0.8 } });

      gsap.utils.toArray<HTMLElement>(".demo-card").forEach((card, index) => {
        gsap.fromTo(card, { y: 90, scale: 0.92 }, { y: index * -18, scale: 1, ease: "none", scrollTrigger: { trigger: card, start: "top 92%", end: "top 42%", scrub: 0.7 } });
      });

      gsap.utils.toArray<HTMLElement>(".platform-reveal").forEach((element) => gsap.from(element, { y: 48, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 88%", once: true } }));
    });
    return () => media.revert();
  }, []);
  return null;
}
