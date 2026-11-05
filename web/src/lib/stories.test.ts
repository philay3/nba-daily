// Run with `npm test` (node --test, no build step).
import assert from "node:assert/strict";
import { test } from "node:test";

import { chartStat, keyFigure, storyChart, storyFigures, storyFilters, storyKey, storyQuery } from "./stories.ts";

test("filters: unknown values are dropped, a player or team widens to the season", () => {
  assert.deepEqual(storyFilters({}), { kind: null, team: null, player: null, scope: "night" });
  assert.deepEqual(storyFilters({ type: "nope", team: "x1", player: "abc" }), { kind: null, team: null, player: null, scope: "night" });
  assert.deepEqual(storyFilters({ type: "streak", team: "bos" }), { kind: "streak", team: "BOS", player: null, scope: "season" });
  assert.deepEqual(storyFilters({ player: "3945274", scope: "night" }), { kind: null, team: null, player: 3945274, scope: "night" });
});

test("query round-trips and leaves out defaults", () => {
  const f = storyFilters({ type: "first", team: "LAL" });
  assert.equal(storyQuery("2026-11-02", f), "date=2026-11-02&type=first&team=LAL");
  assert.deepEqual(storyFilters(Object.fromEntries(new URLSearchParams(storyQuery(undefined, f)))), f);
  assert.equal(storyQuery(undefined, f, { team: null }), "type=first&scope=season");
  assert.equal(storyQuery(undefined, storyFilters({}), { scope: "season" }), "scope=season");
});

test("chart stat follows the story", () => {
  assert.equal(chartStat({ kind: "outlier", subtype: "reb_high", evidence: { stat: "reb" } }), "reb");
  assert.equal(chartStat({ kind: "streak", subtype: "tpm3", evidence: {} }), "tpm");
  assert.equal(chartStat({ kind: "rare", subtype: "20_20", evidence: {} }), "reb");
  assert.equal(chartStat({ kind: "streak", subtype: "dd", evidence: {} }), "pts");
});

test("key figure", () => {
  const base = { value: null, games: 5, z: null };
  assert.equal(keyFigure({ ...base, kind: "outlier", subtype: "pts_high", evidence: {}, z: 3.42 }), "+3.4 SD vs 5 games");
  assert.equal(keyFigure({ ...base, kind: "outlier", subtype: "pts_low", evidence: {}, z: -2.04 }), "−2.0 SD vs 5 games");
  assert.equal(keyFigure({ ...base, kind: "streak", subtype: "dd", evidence: {}, value: 4 }), "4 games in a row");
  assert.equal(keyFigure({ ...base, kind: "rare", subtype: "td", evidence: { league_count: 0, league_games: 1983 } }), "First in 1,983 player games");
  assert.equal(
    keyFigure({ ...base, kind: "team", subtype: "hot", evidence: { last: { games: 3, w: 3, l: 0, net: 12.25 }, rest: { games: 3, w: 0, l: 3, net: -9 } } }),
    "Net +12.3 vs −9.0 before",
  );
  assert.equal(storyKey({ story_date: "2026-11-01", rank: 3 }), "2026-11-01-3");
});

const log = [
  { game_id: 1, game_date: "2026-10-21", opp_code: "NYK", home_away: "home", fga: 10, fta: 2, pts: 10, plus_minus: 4 },
  { game_id: 2, game_date: "2026-10-23", opp_code: "BOS", home_away: "away", fga: 12, fta: 0, pts: 14, plus_minus: -6 },
  { game_id: 3, game_date: "2026-10-25", opp_code: "MIA", home_away: "home", fga: 20, fta: 8, pts: 31, plus_minus: 12 },
  { game_id: 4, game_date: "2026-10-27", opp_code: "MIA", home_away: "home", fga: 20, fta: 8, pts: 40, plus_minus: 1 },
];
const row = { kind: "outlier", subtype: "pts_high", evidence: { stat: "pts" }, value: 31, baseline: 12, z: 3.8, games: 2, game_id: 3, story_date: "2026-10-25", player_id: 7 };

test("figures of an outlier", () => {
  assert.deepEqual(storyFigures(row), [
    ["That night", "31"],
    ["Average before (2 games)", "12.0"],
    ["Above or below", "+3.8 SD"],
  ]);
});

test("chart stops at the story's night and marks it", () => {
  const c = storyChart(row, log)!;
  assert.equal(c.points.length, 3);
  assert.deepEqual(c.points.map((p) => p.strong), [false, false, true]);
  assert.equal(c.avg, 12);
  const streak = storyChart({ ...row, kind: "streak", subtype: "pts20", evidence: { games: [{ date: "2026-10-25", game_id: 3, opp: "MIA" }] } }, log)!;
  assert.equal(streak.avg, 12); // plain average of the games before
  assert.equal(storyChart({ ...row, story_date: "2026-10-21" }, log), null);
});
