/**
 * Team colors on a dark surface. ESPN's primary colors include several navies and purples that
 * disappear on our arena navy, so marks use an "accent": the primary when it reads (3:1 against
 * the surface), else the secondary, else the primary lightened until it reads.
 * Text never takes the team color; identity rides on a stripe, dot or slab beside the text.
 */

export const SURFACE = "#101f33";
export const ARENA = "#0b1624";

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function luminance(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(hex: string, other: string, t: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  if (!a || !b) return hex;
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

function saturation(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const mx = Math.max(...c) / 255;
  const mn = Math.min(...c) / 255;
  return mx === 0 ? 0 : (mx - mn) / mx;
}

const cache = new Map<string, string>();

export function teamAccent(primary: string, secondary?: string | null, surface = SURFACE): string {
  const key = `${primary}|${secondary}|${surface}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = primary;
  if (contrast(primary, surface) >= 3) out = primary;
  else if (secondary && contrast(secondary, surface) >= 3 && (saturation(secondary) > 0.25 || saturation(primary) < 0.15)) out = secondary;
  else {
    let t = 0;
    while (contrast(out, surface) < 3 && t < 1) {
      t += 0.08;
      out = mix(primary, "#ffffff", t);
    }
  }
  cache.set(key, out);
  return out;
}

/** White or arena ink on a solid team-color fill, whichever reads better. */
export function inkOn(fill: string): string {
  return contrast(fill, "#ffffff") >= contrast(fill, ARENA) ? "#ffffff" : ARENA;
}

export function withAlpha(hex: string, alpha: number): string {
  const c = rgb(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : hex;
}

export const CHART = {
  plus: "#3d9be9",
  minus: "#e8683f",
  east: "#1f9e8a",
  west: "#9b6fe0",
  grid: "#1e3352",
  axis: "#2d4a70",
  ink: "#edf2f8",
  ink2: "#b6c3d6",
  muted: "#8293ab",
  clock: "#ffb627",
  surface: SURFACE,
  arena: ARENA,
} as const;
