"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Kinetic headline. Splits the provided text into per-word / per-character spans
 * (a self-contained split, no premium SplitText plugin needed) and runs a
 * masked, staggered reveal on mount. Each word is clipped so characters rise
 * from beneath the baseline.
 */
export default function KineticHeadline({
  text,
  className = "",
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const root = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!root.current) return;
    const chars = root.current.querySelectorAll<HTMLElement>("[data-char]");
    const ctx = gsap.context(() => {
      gsap.from(chars, {
        yPercent: 120,
        opacity: 0,
        rotateX: -40,
        duration: 0.9,
        ease: "power4.out",
        stagger: 0.025,
        delay,
      });
    }, root);
    return () => ctx.revert();
  }, [text, delay]);

  const words = text.split(" ");
  return (
    <h1 ref={root} className={className} aria-label={text} style={{ perspective: 800 }}>
      {words.map((word, wi) => (
        <span
          key={wi}
          className="inline-block overflow-hidden align-bottom"
          style={{ marginRight: "0.25em" }}
        >
          {[...word].map((ch, ci) => (
            <span key={ci} data-char className="inline-block will-change-transform">
              {ch}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}
