/**
 * Theme provider + useTheme() hook.
 *
 * Phase 14a: theme is fixed at startup via --theme CLI flag. Phase 14b adds
 * /theme command to switch at runtime, using setThemeName.
 */

import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";
import {
  BUILTIN_THEMES,
  defaultTheme,
  resolveTheme,
  type ThemeConfig,
} from "./builtinThemes.js";

interface ThemeCtxValue {
  theme: ThemeConfig;
  themeName: string;
  setThemeName: (name: string) => void;
}

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: defaultTheme,
  themeName: "default",
  setThemeName: () => {},
});

export interface ThemeProviderProps {
  initialTheme?: string;
  children: React.ReactNode;
}

export function ThemeProvider({
  initialTheme = "default",
  children,
}: ThemeProviderProps): React.JSX.Element {
  const [themeName, setThemeNameState] = useState(() =>
    BUILTIN_THEMES[initialTheme] !== undefined ? initialTheme : "default",
  );

  const value = useMemo<ThemeCtxValue>(
    () => ({
      theme: resolveTheme(themeName),
      themeName,
      setThemeName: (name: string): void => {
        if (BUILTIN_THEMES[name] !== undefined) {
          setThemeNameState(name);
        }
      },
    }),
    [themeName],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeCtxValue {
  return useContext(ThemeCtx);
}
