// Run with `npm test` (node --test, no build step). The shot chart's numbers come from here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { COURT, hexbin, hexPath, hexScale, periodLabel, shotTitle, type ShotLike, zoneClass, zoneCounts, ZONES } from "./shots.ts";

const shot = (x: number, y: number, made: boolean, zone = "midrange"): ShotLike => ({ x, y, made, zone });

test("zone counts add up to all shots", () => {
  const shots = [shot(0, 1, true, "restricted_area"), shot(0, 2, false, "restricted_area"), shot(-23, 2, true, "corner_3"), shot(5, 30, false, "nowhere")];
  const c = zoneCounts(shots);
  assert.deepEqual(c.restricted_area, { fga: 2, fgm: 1 });
  assert.deepEqual(c.corner_3, { fga: 1, fgm: 1 });
  assert.deepEqual(c.paint, { fga: 0, fgm: 0 });
  assert.deepEqual(c.all, { fga: 4, fgm: 2 }); // an unknown zone still counts as a shot
  assert.equal(ZONES.reduce((n, z) => n + c[z].fga, 0), 3);
});

// every whole-foot spot on the half court, like ESPN's coordinates
const spots: ShotLike[] = [];
for (let x = -25; x <= 25; x++) for (let y = -5; y <= 41; y++) spots.push(shot(x, y, (x + y) % 3 === 0));

test("every shot lands in exactly one hex, and inside it", () => {
  for (const r of [1, 1.6, 2.5]) {
    const hexes = hexbin(spots, r);
    assert.equal(hexes.reduce((n, h) => n + h.n, 0), spots.length);
    assert.equal(new Set(hexes.map((h) => `${h.cx.toFixed(3)},${h.cy.toFixed(3)}`)).size, hexes.length);
    // a pointy-top hexagon of radius r reaches r from its center at the corners, r * sqrt(3) / 2 at the edges
    const centers = hexes.map((h) => [h.cx, h.cy]);
    for (const s of spots) {
      const own = hexbin([s], r)[0];
      const d = Math.hypot(s.x - own.cx, s.y - own.cy);
      assert.ok(d <= r + 1e-9, `(${s.x}, ${s.y}) is ${d.toFixed(2)} ft from its hex center at r = ${r}`);
      assert.ok(centers.some(([cx, cy]) => Math.abs(cx - own.cx) < 1e-9 && Math.abs(cy - own.cy) < 1e-9));
    }
  }
});

test("a hex takes the zone most of its shots came from", () => {
  // three shots on one spot: two midrange, one corner three; three made
  const [h] = hexbin([shot(21, 0, true, "midrange"), shot(21, 0, true, "corner_3"), shot(21, 0, true, "midrange")], 2);
  assert.deepEqual([h.n, h.made, h.zone], [3, 3, "midrange"]);
  // a tie goes to the zone nearer the rim
  const [tie] = hexbin([shot(0, 4, false, "paint"), shot(0, 4, true, "restricted_area")], 2);
  assert.equal(tie.zone, "restricted_area");
});

test("zone classes: 3 and 9 points either side, gray below five attempts", () => {
  assert.equal(zoneClass(9, 10), 2);
  assert.equal(zoneClass(8.9, 10), 1);
  assert.equal(zoneClass(3, 10), 1);
  assert.equal(zoneClass(2.9, 10), 0);
  assert.equal(zoneClass(-2.9, 10), 0);
  assert.equal(zoneClass(-3, 10), -1);
  assert.equal(zoneClass(-9, 10), -2);
  assert.equal(zoneClass(40, 4), 0); // 4 attempts: too few to say
  assert.equal(zoneClass(40, 5), 2);
  assert.equal(zoneClass(null, 10), 0);
});

test("hex size grows with attempts, from 30% to full", () => {
  const size = hexScale([1, 2, 3, 4, 5, 6, 8, 10, 20, 40].map((n) => ({ n })));
  assert.equal(size(40), 1);
  assert.equal(size(20), 1); // the busiest 15% of hexes are full size
  assert.equal(size(1), Math.max(0.3, Math.sqrt(1 / 20)));
  assert.ok(size(5) > size(2));
  assert.equal(hexScale([])(1), Math.sqrt(1 / 3));
});

test("hex path has six corners on the circle", () => {
  const pts = hexPath(10).slice(1, -1).split("L").map((p) => p.split(",").map(Number));
  assert.equal(pts.length, 6);
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x, y) - 10) < 0.01);
});

test("shot tooltips read as a sentence", () => {
  const s = { made: true, distance: 18.4, shot_type: "Pullup Jump Shot", points: 2, period: 3, clock: "4:12" };
  assert.equal(shotTitle(s, "Jalen Brunson"), "Jalen Brunson made an 18 ft pullup jump shot (2), Q3 4:12");
  assert.equal(shotTitle({ ...s, made: false, distance: 24.9, period: 5, clock: "0.8" }), "missed a 25 ft pullup jump shot, OT 0.8");
  assert.equal(shotTitle({ ...s, distance: 8, period: 6 }), "made an 8 ft pullup jump shot (2), 2OT 4:12");
  assert.equal(shotTitle({ ...s, distance: 84 }), "made an 84 ft pullup jump shot (2), Q3 4:12");
  assert.deepEqual([1, 4, 5, 7].map(periodLabel), ["Q1", "Q4", "OT", "3OT"]);
});

test("court: the corner line meets the arc 8.95 ft past the rim", () => {
  assert.ok(Math.abs(COURT.cornerTop - 8.95) < 0.01);
  assert.equal(COURT.halfCourt - COURT.baseline, 47);
});
