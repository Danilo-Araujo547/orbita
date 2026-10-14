import { useEffect } from "react";

export default function OrbitFavicon() {
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    const original = icon.href;
    let previous = "";
    const update = () => {
      const logo = document.querySelector<HTMLElement>(
        ".sidebar .brand .logo-symbol, .brand .logo-symbol",
      );
      if (!logo) return;
      // Read the rendered logo's phase, rather than starting a second clock.
      // This also follows theme changes, reduced motion and remounted sidebars.
      const style = getComputedStyle(logo);
      const matrix = new DOMMatrixReadOnly(
        style.transform === "none" ? undefined : style.transform,
      );
      const angle = ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI).toFixed(
        2,
      );
      const ring = style.borderTopColor;
      const dot = getComputedStyle(logo, "::after").backgroundColor;
      const background = getComputedStyle(
        document.querySelector(".sidebar") || document.body,
      ).backgroundColor;
      const signature = `${angle}|${ring}|${dot}|${background}`;
      if (signature === previous) return;
      previous = signature;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${background}"/><g transform="rotate(${angle} 32 32)"><circle cx="32" cy="32" r="19" fill="none" stroke="${ring}" stroke-width="6"/><circle cx="50" cy="17" r="5" fill="${dot}" stroke="${background}" stroke-width="3"/></g></svg>`;
      icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      icon.dataset.orbitAngle = angle;
    };
    update();
    // Four tiny frames per second are enough for the two-minute orbit.
    const timer = window.setInterval(update, 250);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      icon.href = original;
      delete icon.dataset.orbitAngle;
    };
  }, []);
  return null;
}
