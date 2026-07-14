import { useEffect, useState } from "react";

/**
 * The Savari suite defaults to dark. Reacts only if the app explicitly sets a
 * `light` class on <html> (it doesn't today), so dark is the effective default.
 */
export function useMcDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const el = document.documentElement;
    const compute = () => setDark(!el.classList.contains("light"));
    compute();
    const obs = new MutationObserver(compute);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
