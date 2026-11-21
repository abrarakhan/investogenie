import * as Haptics from "expo-haptics";
import type { TextStyle } from "react-native";

/**
 * Shared design tokens for the InvestoGenie mobile terminal.
 *
 * Semantic color policy:
 * - Emerald is reserved for actionable / confirmed positive states.
 * - Amber is for waiting / caution / cached states.
 * - Rose is for invalidation / risk / negative states.
 * - Violet is for research / strategy context.
 */
export const colors = {
  // Layered near-black surfaces (avoid pure #000 cards)
  bg: "#07090d",
  surface: "#0e1219",
  surfaceRaised: "#141a24",
  surfaceInset: "#0a0e14",

  // Borders
  border: "#1f2632",
  borderStrong: "#2d3748",

  // Text hierarchy
  text: "#f8fafc",
  textSecondary: "#cbd5e1",
  textMuted: "#8b95a5",
  textSubtle: "#647082",

  // Semantic accents
  emerald: "#34d399",
  emeraldText: "#6ee7b7",
  emeraldBg: "#0d2c21",
  emeraldBorder: "#23835f",
  emeraldInk: "#04110d",

  amber: "#fbbf24",
  amberBg: "#30250d",
  amberBorder: "#8a6417",

  rose: "#fb7185",
  roseText: "#fecdd3",
  roseBg: "#35131d",
  roseBorder: "#9f2942",

  violet: "#a78bfa",
  violetText: "#ddd6fe",
  violetBg: "#1e1633",
  violetBorder: "#5b3ea6",

  link: "#5eead4",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const tabularNums: TextStyle = {
  fontVariant: ["tabular-nums"],
};

export const typography = {
  screenTitle: { color: colors.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.4 } as TextStyle,
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.2 } as TextStyle,
  ticker: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.2 } as TextStyle,
  detailTicker: { color: colors.text, fontSize: 32, fontWeight: "900", letterSpacing: -0.4 } as TextStyle,
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 } as TextStyle,
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 } as TextStyle,
  caption: { color: colors.textSubtle, fontSize: 11, fontWeight: "700" } as TextStyle,
  metricLabel: { color: colors.textSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 } as TextStyle,
  metricValue: { color: colors.text, fontSize: 15, fontWeight: "800", ...tabularNums } as TextStyle,
} as const;

export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function hapticSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function hapticWarning(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
