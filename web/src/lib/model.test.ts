// Run with `npm test`. Line text and edges on the Today, game, Model and studio pages come from here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { atsPct, atsWord, edgeText, lineText, pickTeam, recordText, winChances, type ModelLike } from "./model.ts";

const m = (pred: number | null, line: number | null, extra: Partial<ModelLike> = {}): ModelLike => ({
  home_code: "BOS",
  away_code: "NYK",
  pred_margin: pred,
  home_wp: 60,
  line_margin: line,
  actual_margin: null,
  pick: null,
  ats: null,
  ...extra,
});

test("a home margin reads as the favorite giving points", () => {
  assert.equal(lineText("BOS", "NYK", 3.5), "BOS -3.5");
  assert.equal(lineText("BOS", "NYK", -6), "NYK -6.0");
  assert.equal(lineText("BOS", "NYK", 0.04), "EVEN");
  assert.equal(lineText("BOS", "NYK", null), "–");
});

test("the edge names the side the model likes against the line", () => {
  assert.equal(edgeText(m(5.2, 3.5)), "BOS by 1.7");
  assert.equal(edgeText(m(-1, 2.5)), "NYK by 3.5");
  assert.equal(edgeText(m(2.5, 2.5)), "No edge");
  assert.equal(edgeText(m(2.5, null)), null);
});

test("picks, results and records", () => {
  assert.equal(pickTeam(m(1, 0, { pick: "away" })), "NYK");
  assert.equal(pickTeam(m(1, 0)), null);
  assert.equal(atsWord("W"), "Won");
  assert.equal(atsWord("P"), "Push");
  assert.equal(atsWord(null), null);
  assert.deepEqual(winChances({ home_wp: 61.3 }), { away: 38.7, home: 61.3 });
  assert.equal(recordText(46, 40, 2), "46-40-2");
  assert.equal(recordText(46, 40, 0), "46-40");
  assert.equal(atsPct(46, 40), "53.5%");
  assert.equal(atsPct(0, 0), "–");
});
