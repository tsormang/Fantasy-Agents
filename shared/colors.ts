export const PC_COLOR_OPTIONS = [
  { id: "blue", label: "Blue", hex: "#3f7fd6", liteIndex: 0 },
  { id: "red", label: "Red", hex: "#d6473f", liteIndex: 1 },
  { id: "yellow", label: "Yellow", hex: "#c9a227", liteIndex: 3 },
  { id: "purple", label: "Purple", hex: "#9a5fd6", liteIndex: 4 },
] as const;

export type PcColor = (typeof PC_COLOR_OPTIONS)[number]["id"];
export const isPcColor = (value: unknown): value is PcColor => PC_COLOR_OPTIONS.some((c) => c.id === value);
/** Keep the original automatic palettes when a PC has no explicit color. */
export function pcColorIndex(color: string | null | undefined, fallbackHash: number, lite = false): number {
  const index = PC_COLOR_OPTIONS.findIndex((c) => c.id === color);
  return index < 0 ? fallbackHash % (lite ? 8 : 4) : lite ? PC_COLOR_OPTIONS[index].liteIndex : index;
}
