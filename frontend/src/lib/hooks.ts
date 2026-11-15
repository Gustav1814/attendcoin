import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(reducedMotionQuery);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

/** Current time in ms, refreshed every `intervalMs`. Pass 0 to pause. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Animates from 0 to `target` the first time a value arrives, then follows
 * later changes without replaying. Skips animation under reduced motion.
 */
export function useCountUp(target: number | null | undefined, durationMs = 900): number | null {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState<number | null>(target ?? null);
  const played = useRef(false);

  useEffect(() => {
    if (target == null) {
      setValue(null);
      return;
    }
    if (played.current || reduced || target === 0) {
      played.current = true;
      setValue(target);
      return;
    }
    played.current = true;
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return value;
}

export function useCopy(timeoutMs = 1500): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), timeoutMs);
    return () => window.clearTimeout(id);
  }, [copied, timeoutMs]);
  return [
    copied,
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        el.remove();
      }
      setCopied(true);
    },
  ];
}
