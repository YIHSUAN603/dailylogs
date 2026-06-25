// 主題：可調主色（從預設色盤選）+ 淺/深色模式。
// 主色透過覆寫 :root 的 --accent-* CSS 變數即時換色（index.css 以 @theme 綁定成 accent utility）；
// 深色模式透過 toggle <html> 的 .dark class。設定存 SQLite settings 表（走既有 getSetting/setSetting）。

export type ThemeMode = "light" | "dark" | "system";
export type AccentName =
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "emerald"
  | "rose"
  | "amber";

type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

/** 各預設色系（值取自 Tailwind 預設調色盤的 50–900）。label 為設定畫面顯示用中文。 */
export const ACCENTS: Record<AccentName, { label: string; scale: Scale }> = {
  sky: {
    label: "天藍",
    scale: {
      50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8",
      500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e",
    },
  },
  blue: {
    label: "靛藍",
    scale: {
      50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa",
      500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a",
    },
  },
  indigo: {
    label: "紫藍",
    scale: {
      50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8",
      500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81",
    },
  },
  violet: {
    label: "紫",
    scale: {
      50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa",
      500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95",
    },
  },
  emerald: {
    label: "綠",
    scale: {
      50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399",
      500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b",
    },
  },
  rose: {
    label: "玫瑰",
    scale: {
      50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185",
      500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337",
    },
  },
  amber: {
    label: "琥珀",
    scale: {
      50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24",
      500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f",
    },
  },
};

export const DEFAULT_ACCENT: AccentName = "sky";
export const DEFAULT_MODE: ThemeMode = "light";

export function isAccentName(v: string | null): v is AccentName {
  return v !== null && v in ACCENTS;
}

export function isThemeMode(v: string | null): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

/** 系統目前偏好深色？ */
export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 把模式解析成實際的深/淺（system 依系統偏好） */
export function resolveMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/** 覆寫 :root 的 --accent-* 變數，即時切換主色 */
export function applyAccent(name: AccentName): void {
  const { scale } = ACCENTS[name];
  const root = document.documentElement;
  for (const [shade, hex] of Object.entries(scale)) {
    root.style.setProperty(`--accent-${shade}`, hex);
  }
}

/** toggle <html> 的 .dark class，切換深淺色（system 依系統偏好解析） */
export function applyMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", resolveMode(mode) === "dark");
}
