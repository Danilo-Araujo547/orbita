export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "orbita-theme";
export const THEME_COLOR_LIGHT = "#ffffff";
export const THEME_COLOR_DARK = "#121212";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function safeGetStorage(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Graceful fallback for SecurityError / QuotaExceeded / disabled storage
  }
  return null;
}

export function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Graceful fallback when storage write fails
  }
}

export function getStoredThemePreference(): ThemePreference {
  const stored = safeGetStorage(THEME_STORAGE_KEY);
  if (isThemePreference(stored)) {
    return stored;
  }
  return "system";
}

export function setStoredThemePreference(preference: ThemePreference): void {
  safeSetStorage(THEME_STORAGE_KEY, preference);
}

export function getSystemTheme(): ResolvedTheme {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  } catch {
    // In case matchMedia throws
  }
  return "light";
}

export function resolveTheme(
  preference: ThemePreference,
  systemTheme?: ResolvedTheme,
): ResolvedTheme {
  if (preference === "system") {
    return systemTheme ?? getSystemTheme();
  }
  return preference;
}

export function applyThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.setAttribute("data-theme", resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolved === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT,
      );
    }
  } catch {
    // Prevent any DOM access edge cases from breaking execution
  }
}
