/**
 * Built-in themes — color palette + icon glyphs that visual components consume
 * via useTheme(). New themes can be added here; CLI/--theme falls back to
 * "default" when an unknown name is given.
 */

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  foreground: string;
  muted: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface ThemeIcons {
  spinner: string[];
  tool: string;
  assistant: string;
  user: string;
  system: string;
  success: string;
  error: string;
}

export interface ThemeConfig {
  name: string;
  colors: ThemeColors;
  icons: ThemeIcons;
}

const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const defaultTheme: ThemeConfig = {
  name: "default",
  colors: {
    primary: "cyan",
    secondary: "white",
    accent: "cyan",
    foreground: "white",
    muted: "gray",
    success: "green",
    warning: "yellow",
    error: "red",
    info: "blue",
  },
  icons: {
    spinner: BRAILLE_SPINNER,
    tool: "⏵ ",
    assistant: "⏺ ",
    user: "> ",
    system: "ℹ ",
    success: "✓ ",
    error: "✗ ",
  },
};

export const darkTheme: ThemeConfig = {
  name: "dark",
  colors: {
    primary: "#7aa2f7",
    secondary: "#c0caf5",
    accent: "#bb9af7",
    foreground: "#c0caf5",
    muted: "#565f89",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    info: "#7dcfff",
  },
  icons: {
    spinner: BRAILLE_SPINNER,
    tool: "⏵ ",
    assistant: "⏺ ",
    user: "> ",
    system: "ℹ ",
    success: "✓ ",
    error: "✗ ",
  },
};

export const minimalTheme: ThemeConfig = {
  name: "minimal",
  colors: {
    primary: "white",
    secondary: "white",
    accent: "white",
    foreground: "white",
    muted: "gray",
    success: "white",
    warning: "white",
    error: "white",
    info: "white",
  },
  icons: {
    spinner: ["-", "\\", "|", "/"],
    tool: "* ",
    assistant: "> ",
    user: "$ ",
    system: "- ",
    success: "+ ",
    error: "! ",
  },
};

export const BUILTIN_THEMES: Record<string, ThemeConfig> = {
  default: defaultTheme,
  dark: darkTheme,
  minimal: minimalTheme,
};

export function resolveTheme(name: string | undefined): ThemeConfig {
  if (name !== undefined && BUILTIN_THEMES[name] !== undefined) {
    return BUILTIN_THEMES[name]!;
  }
  return defaultTheme;
}
