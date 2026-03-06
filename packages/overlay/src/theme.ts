import React, { createContext, useContext, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Color token type
// ---------------------------------------------------------------------------

export interface ThemeTokens {
  // Surfaces
  panelBg: string;
  cardBg: string;
  toolbarBg: string;
  drawerBg: string;
  hoverBg: string;
  activeBg: string;

  // Borders
  border: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;

  // Icons
  iconDefault: string;
  iconHover: string;

  // Overlay / spinner
  suspenseOverlay: string;
  spinnerBg: string;
  spinnerFg: string;

  // Tooltip
  tooltipBg: string;
  tooltipText: string;
  tooltipKeyBg: string;
  tooltipKeyText: string;

  // Button (dark submit button in SelectionPanel)
  buttonBg: string;
  buttonText: string;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const light: ThemeTokens = {
  panelBg: "#f7f7f7",
  cardBg: "#fff",
  toolbarBg: "#fff",
  drawerBg: "#efefef",
  hoverBg: "#f0f0f0",
  activeBg: "#e8e8e8",

  border: "#e0e0e0",

  textPrimary: "#333",
  textSecondary: "#666",
  textTertiary: "#999",
  textDisabled: "#888",

  iconDefault: "#666",
  iconHover: "#141414",

  suspenseOverlay: "rgba(255,255,255,0.75)",
  spinnerBg: "#e0e0e0",
  spinnerFg: "#666",

  tooltipBg: "#fff",
  tooltipText: "#333",
  tooltipKeyBg: "#f0f0f0",
  tooltipKeyText: "#888",

  buttonBg: "#333",
  buttonText: "#fff",
};

const dark: ThemeTokens = {
  panelBg: "#1e1e1e",
  cardBg: "#2a2a2a",
  toolbarBg: "#2a2a2a",
  drawerBg: "#252525",
  hoverBg: "#333",
  activeBg: "#3a3a3a",

  border: "#3a3a3a",

  textPrimary: "#e0e0e0",
  textSecondary: "#999",
  textTertiary: "#666",
  textDisabled: "#555",

  iconDefault: "#999",
  iconHover: "#e0e0e0",

  suspenseOverlay: "rgba(30,30,30,0.75)",
  spinnerBg: "#3a3a3a",
  spinnerFg: "#999",

  tooltipBg: "#2a2a2a",
  tooltipText: "#e0e0e0",
  tooltipKeyBg: "rgba(255,255,255,0.1)",
  tooltipKeyText: "#777",

  buttonBg: "#e0e0e0",
  buttonText: "#1e1e1e",
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** Parse an rgb/rgba string and return relative luminance (0 = black, 1 = white). */
function luminance(color: string): number | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  // sRGB luminance
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Detect whether a document is using a dark theme.
 * Accepts an optional target Document (e.g. an iframe's contentDocument)
 * so the toolbar can adapt to whichever iteration is currently active.
 */
function detectDark(doc?: Document | null): boolean {
  const targetDoc = doc ?? document;
  const html = targetDoc.documentElement;

  // 1. Check <html> attributes & classes (most common framework convention)
  const htmlDataTheme = html.getAttribute("data-theme") ?? html.getAttribute("data-color-mode") ?? "";
  if (htmlDataTheme === "dark") return true;
  if (htmlDataTheme === "light") return false;
  if (html.classList.contains("dark")) return true;
  if (html.classList.contains("light")) return false;

  // 2. Check color-scheme CSS property on html/body
  const htmlScheme = targetDoc.defaultView?.getComputedStyle(html).colorScheme ?? "";
  if (htmlScheme === "dark") return true;
  if (htmlScheme === "light") return false;
  const body = targetDoc.body;
  if (body) {
    const bodyScheme = targetDoc.defaultView?.getComputedStyle(body).colorScheme ?? "";
    if (bodyScheme === "dark") return true;
    if (bodyScheme === "light") return false;
  }

  // 3. Body background luminance heuristic
  if (body) {
    const bg = targetDoc.defaultView?.getComputedStyle(body).backgroundColor ?? "";
    const lum = luminance(bg);
    if (lum !== null && lum < 0.2) return true;
    if (lum !== null && lum > 0.8) return false;
  }

  // 4. System preference as final fallback
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeTokens>(light);

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  children,
  targetDocument,
}: {
  children: React.ReactNode;
  /** Optional document to detect theme from (e.g. an iteration iframe's contentDocument).
   *  Falls back to the current document when null/undefined. */
  targetDocument?: Document | null;
}) {
  const [isDark, setIsDark] = useState(() => detectDark(targetDocument));

  // Re-detect immediately when targetDocument changes (tab switch)
  useEffect(() => {
    setIsDark(detectDark(targetDocument));
  }, [targetDocument]);

  useEffect(() => {
    const doc = targetDocument ?? document;
    const redetect = () => setIsDark(detectDark(doc));

    // Re-detect on system preference change
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", redetect);

    // Observe <html> attribute/class changes (covers data-theme, class toggles)
    const observer = new MutationObserver(redetect);
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-mode", "style"],
    });

    // Also observe <body> for style/class changes (color-scheme, background)
    if (doc.body) {
      observer.observe(doc.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    return () => {
      mq.removeEventListener("change", redetect);
      observer.disconnect();
    };
  }, [targetDocument]);

  return React.createElement(ThemeContext.Provider, { value: isDark ? dark : light }, children);
}
