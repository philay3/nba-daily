import { SIZES, TEMPLATES, type SizeKey, type StudioSelection, type TemplateKey } from "@/lib/studio-types";

export type StudioSearch = { date?: string; t?: string; size?: string; player?: string; game?: string; teams?: string; handle?: string; shot?: string };

export const DEFAULT_HANDLE = process.env.NEXT_PUBLIC_BRAND_HANDLE || "@nbadaily";

/** URL query -> a studio selection (unknown values fall back to defaults). */
export function selectionFromSearch(sp: StudioSearch): StudioSelection {
  const template = (sp.t && sp.t in TEMPLATES ? sp.t : "player") as TemplateKey;
  const size = (sp.size && sp.size in SIZES ? sp.size : "feed") as SizeKey;
  return {
    template,
    size,
    handle: (sp.handle ?? DEFAULT_HANDLE).slice(0, 40),
    player: sp.player,
    matchup: template === "matchup" ? sp.game : undefined,
    recap: template === "recap" ? sp.game : undefined,
    shot: template === "shots" ? sp.shot : undefined,
    flow: template === "flow" ? sp.game : undefined,
    model: template === "model" ? sp.game : undefined,
    highlight: sp.teams ? sp.teams.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 2) : undefined,
  };
}
