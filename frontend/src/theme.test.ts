import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  isThemePreference,
  resolveTheme,
  getStoredThemePreference,
  setStoredThemePreference,
  getSystemTheme,
  applyThemeToDocument,
  THEME_STORAGE_KEY,
  THEME_COLOR_LIGHT,
  THEME_COLOR_DARK,
} from "./theme";

describe("preferência de tema e resolução", () => {
  it("valida corretamente os identificadores de tema aceitos", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("neon")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });

  it("resolve tema claro e escuro explicitamente independentemente do sistema", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("light", "light")).toBe("light");
    expect(resolveTheme("dark", "dark")).toBe("dark");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("resolve tema do sistema de acordo com a preferência detectada", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
  });
});

describe("persistência e tolerância a falhas no armazenamento", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const fakeLocalStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = String(value);
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      key: () => null,
      length: 0,
    };

    vi.stubGlobal("window", {
      localStorage: fakeLocalStorage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persiste a preferência selecionada no localStorage", () => {
    setStoredThemePreference("dark");
    expect(mockStorage[THEME_STORAGE_KEY]).toBe("dark");
    expect(getStoredThemePreference()).toBe("dark");

    setStoredThemePreference("light");
    expect(mockStorage[THEME_STORAGE_KEY]).toBe("light");
    expect(getStoredThemePreference()).toBe("light");

    setStoredThemePreference("system");
    expect(mockStorage[THEME_STORAGE_KEY]).toBe("system");
    expect(getStoredThemePreference()).toBe("system");
  });

  it("retorna 'system' como padrão quando não há chave gravada ou o valor for inválido", () => {
    expect(getStoredThemePreference()).toBe("system");

    mockStorage[THEME_STORAGE_KEY] = "invalid-value";
    expect(getStoredThemePreference()).toBe("system");
  });

  it("não quebra a aplicação caso o localStorage lance exceção (modo anônimo restrito)", () => {
    const errorStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      setItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
    };
    vi.stubGlobal("window", { localStorage: errorStorage });

    expect(() => getStoredThemePreference()).not.toThrow();
    expect(getStoredThemePreference()).toBe("system");

    expect(() => setStoredThemePreference("dark")).not.toThrow();
  });
});

describe("comportamento do tema do sistema", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detecta tema escuro quando prefers-color-scheme coincide", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    expect(getSystemTheme()).toBe("dark");
  });

  it("detecta tema claro quando prefers-color-scheme não é escuro", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    expect(getSystemTheme()).toBe("light");
  });

  it("retorna 'light' como fallback seguro se matchMedia não estiver disponível", () => {
    vi.stubGlobal("window", {});
    expect(getSystemTheme()).toBe("light");
  });
});

describe("aplicação de tema no documento", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aplica atributo data-theme e atualiza meta theme-color", () => {
    const attributes: Record<string, string> = {};
    const metaAttrs: Record<string, string> = { name: "theme-color", content: "" };

    const docMock = {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
        getAttribute: (name: string) => attributes[name] ?? null,
      },
      querySelector: (selector: string) => {
        if (selector === 'meta[name="theme-color"]') {
          return {
            setAttribute: (name: string, value: string) => {
              metaAttrs[name] = value;
            },
            getAttribute: (name: string) => metaAttrs[name] ?? null,
          };
        }
        return null;
      },
    };

    vi.stubGlobal("document", docMock);

    applyThemeToDocument("dark");
    expect(attributes["data-theme"]).toBe("dark");
    expect(metaAttrs["content"]).toBe(THEME_COLOR_DARK);

    applyThemeToDocument("light");
    expect(attributes["data-theme"]).toBe("light");
    expect(metaAttrs["content"]).toBe(THEME_COLOR_LIGHT);
  });
});
