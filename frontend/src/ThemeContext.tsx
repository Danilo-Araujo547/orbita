import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeToDocument,
  getStoredThemePreference,
  getSystemTheme,
  resolveTheme,
  setStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getStoredThemePreference(),
  );
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme(),
  );

  const resolvedTheme = useMemo(
    () => resolveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  const setTheme = useCallback(
    (nextPref: ThemePreference) => {
      setPreferenceState(nextPref);
      setStoredThemePreference(nextPref);
      const nextResolved = resolveTheme(nextPref, systemTheme);
      applyThemeToDocument(nextResolved);
    },
    [systemTheme],
  );

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateSystemTheme = (matches: boolean) => {
      setSystemTheme(matches ? "dark" : "light");
    };

    updateSystemTheme(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      updateSystemTheme(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else if (
      "addListener" in mediaQuery &&
      typeof (mediaQuery as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener === "function"
    ) {
      const legacyQuery = mediaQuery as unknown as {
        addListener: (cb: (e: MediaQueryListEvent) => void) => void;
        removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacyQuery.addListener(listener);
      return () => legacyQuery.removeListener(listener);
    }
  }, []);

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setTheme,
    }),
    [preference, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
