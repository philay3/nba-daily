"""Play-by-play: game flow, runs, clutch time, who is on the floor, lineups and on/off.

Small synthetic games pin each rule. The fixture day (ESPN's play-by-play for the 92 games before 2026-11-02) is
checked against things the play-by-play does not decide: the box score's final scores, minutes, plus-minus, lead
changes, largest leads and possessions, and an independent count of clutch points.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd
import pytest
from helpers import DAY, HOOPR, INPUTS

from nba_pipeline import pbp
from nba_pipeline.run import run_day

# kind -> (type_id, type_text, shooting_play, points_attempted)
KINDS = {
    "sub": (584, "Substitution", False, 0),
    "fg2": (92, "Jump Shot", True, 2),
    "fg3": (92, "Jump Shot", True, 3),
    "heave": (282, "Heave Jump Shot", True, 3),
    "ft": (98, "Free Throw - 1 of 2", True, 1),
    "dreb": (155, "Defensive Rebound", False, 0),
    "oreb": (156, "Offensive Rebound", False, 0),
    "tov": (63, "Lost Ball Turnover", False, 0),
    "travel": (64, "Traveling", False, 0),
    "foul": (44, "Shooting Foul", False, 0),
    "tech": (35, "Technical Foul", False, 0),
    "end": (412, "End Period", False, 0),
}
AWAY = [101, 102, 103, 104, 105, 106, 107, 108]
HOME = [201, 202, 203, 204, 205, 206, 207, 208]
ROSTER = {**{a: "away" for a in AWAY}, **{a: "home" for a in HOME}}
STARTERS = {"away": AWAY[:5], "home": HOME[:5]}


def raw_game(rows, gid=1):
    """rows: (period, clock, kind, side, a1, a2, pts) -> raw play-by-play in hoopR's columns, running score included."""
    out, score = [], {"away": 0, "home": 0}
    for n, (period, clock, kind, side, a1, a2, pts) in enumerate(rows, 1):
        mins, secs = clock.split(":") if ":" in clock else ("0", clock)
        type_id, text, shooting, attempted = KINDS[kind]
        if pts:
            score[side] += pts
        out.append(dict(
            game_id=gid, season_type=2, game_date="2026-10-21", game_play_number=n, type_id=type_id, type_text=text,
            period_number=period, clock_minutes=int(mins), clock_seconds=float(secs), scoring_play=pts > 0,
            score_value=pts, shooting_play=shooting, points_attempted=attempted,
            team_id={"away": 1.0, "home": 2.0}.get(side, np.nan), athlete_id_1=float(a1) if a1 else np.nan,
            athlete_id_2=float(a2) if a2 else np.nan, athlete_id_3=np.nan, away_score=score["away"],
            home_score=score["home"], away_team_id=1, home_team_id=2, away_team_abbrev="TOR", home_team_abbrev="LAL"))
    return pd.DataFrame(out, columns=pbp.COLUMNS)


def rebuild(rows, periods=1, starters=STARTERS, minutes=None):
    plays = pbp.normalize(raw_game(rows))
    return pbp.rebuild_game(plays, periods, ROSTER, starters, minutes or {}, pbp.clutch_segments(plays, periods))


def lineup_at(stints, t, side):
    """Who is on the floor just after elapsed second t."""
    for st in stints:
        if st.start <= t < st.end:
            return set(st.lineup[side])
    raise AssertionError(f"no stint at {t}")


def secs_on(stints):
    out = defaultdict(float)
    for st in stints:
        for s in pbp.SIDES:
            for a in st.lineup[s]:
                out[a] += st.secs
    return out


# ------------------------------------------------------------------ reading plays


def test_normalize_flags_and_clock():
    plays = pbp.normalize(raw_game([
        (1, "11:40", "heave", "away", 101, 0, 0),  # a missed heave is not a field goal attempt (as in the box score)
        (1, "11:20", "heave", "away", 102, 0, 3),  # a made one is
        (1, "11:00", "oreb", "away", 0, 0, 0),  # a team rebound is not a player's offensive rebound
        (1, "10:30", "travel", "home", 201, 0, 0),
        (1, "10:00", "tech", "home", 207, 0, 0),  # a technical can name a player on the bench
        (1, "0:24.6", "ft", "home", 202, 0, 1),
        (5, "4:00", "fg2", "away", 101, 0, 2),
    ]))
    assert plays.fga.tolist() == [False, True, False, False, False, False, True]
    assert plays.tpm.tolist() == [False, True, False, False, False, False, False]
    assert plays.oreb.sum() == 0 and plays.tov.tolist()[3] and plays.fta.tolist()[5]
    assert plays.present.tolist()[4] is np.False_ or not plays.present.tolist()[4]
    assert plays.t.tolist()[5] == pytest.approx(720 - 24.6)
    assert plays.t.tolist()[6] == pytest.approx(2880 + 60)  # first overtime starts at 48:00
    assert pbp.clock_text(24.6) == "24.6" and pbp.clock_text(465) == "7:45"


def test_possession_estimate():
    own = np.zeros(len(pbp.STATS), dtype=int)
    opp = np.zeros(len(pbp.STATS), dtype=int)
    own[[pbp.FGA, pbp.OREB, pbp.TOV, pbp.FTA]] = [40, 5, 7, 10]  # 40 - 5 + 7 + 4.4 = 46.4
    opp[[pbp.FGA, pbp.OREB, pbp.TOV, pbp.FTA]] = [44, 8, 6, 5]  # 44 - 8 + 6 + 2.2 = 44.2
    assert pbp.possessions(own, opp) == pytest.approx(45.3)


# ------------------------------------------------------------------ game flow and runs


def test_flow_lead_changes_ties_and_leads():
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),  # 2-0 at 60 s
            (1, "10:00", "fg3", "home", 201, 0, 3),  # 2-3 at 120 s: first lead change
            (1, "9:00", "fg2", "away", 102, 0, 1),  # 3-3 at 180 s: tied (a one-point basket keeps the test short)
            (1, "8:00", "fg3", "home", 202, 0, 3),  # 3-6: home led before the tie, so not a change
            (1, "7:00", "fg3", "away", 103, 0, 3),  # 6-6 tied
            (1, "6:00", "fg3", "away", 103, 0, 3)]  # 9-6: lead change
    plays = pbp.normalize(raw_game(rows))
    f = pbp.flow_of(plays, 4)
    assert f["t"] == [60.0, 120.0, 180.0, 240.0, 300.0, 360.0]
    assert f["away"] == [2, 2, 3, 3, 6, 9] and f["home"] == [0, 3, 3, 6, 6, 6]
    assert (f["lead_changes"], f["times_tied"]) == (2, 2)
    assert (f["away_largest_lead"], f["home_largest_lead"]) == (3, 3)
    # led: away 60-120 and 360-2880, home 120-180 and 240-300, tied 0-60, 180-240 and 300-360
    assert (f["away_lead_secs"], f["home_lead_secs"], f["tied_secs"]) == (60 + 2520, 120.0, 180.0)


def test_runs_are_unanswered_points():
    rows = [(1, "11:00", "fg2", "home", 201, 0, 2),
            (1, "10:00", "fg3", "away", 101, 0, 3),
            (1, "9:30", "ft", "away", 102, 0, 1),
            (1, "9:00", "fg2", "away", 103, 0, 2),
            (1, "8:15", "fg2", "away", 104, 0, 2),  # 8-0 away run from 10:00 to 8:15
            (1, "8:00", "fg2", "home", 202, 0, 2),
            (1, "7:00", "fg2", "home", 203, 0, 2)]  # home's biggest run is 4
    runs = pbp.runs_of(pbp.normalize(raw_game(rows)))
    assert [(r["side"], r["pts"], r["biggest"]) for r in runs] == [("away", 8, True), ("home", 4, True)]
    a = runs[0]
    assert (a["start_rem"], a["end_rem"], a["plays"]) == (600.0, 495.0, 4)
    assert (a["away_before"], a["home_before"], a["away_after"], a["home_after"]) == (0, 2, 8, 2)


def test_clutch_time_and_plays():
    rows = [(4, "7:00", "fg3", "away", 101, 0, 3),  # 3-0 before the window
            (4, "4:30", "fg3", "away", 101, 0, 3),  # margin before this play is 3: clutch; 6-0 after
            (4, "3:00", "fg3", "away", 101, 0, 3),  # margin before is 6: not clutch; 9-0 after
            (4, "1:00", "fg2", "home", 201, 0, 2),  # 9 before: not clutch; 9-2
            (5, "4:00", "fg2", "home", 201, 0, 2)]  # overtime starts 9-2: not clutch until this basket makes it 9-4
    plays = pbp.normalize(raw_game(rows))
    assert plays.clutch.tolist() == [False, True, False, False, False]
    segs = pbp.clutch_segments(plays, 5)
    # from the window opening (43:00 = 2580 s) to the 6-0 basket at 4:30 (2610 s); then from 9-4 at 4:00 of
    # overtime (2940 s) to the end of overtime (3180 s)
    assert segs == [(2580.0, 2610.0), (2940.0, 3180.0)]


# ------------------------------------------------------------------ who is on the floor


def test_starters_from_events_and_carried_over_players():
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),
            (1, "10:00", "sub", "away", 106, 105, 0),  # 106 in for 105
            (1, "9:00", "fg2", "home", 201, 0, 2),
            (1, "0.0", "end", "", 0, 0, 0),
            # period 2: 102 leaves before he appears, 101 and 103 appear, 106 carries over, 104 is never named
            (2, "12:00", "sub", "away", 107, 102, 0),
            (2, "11:00", "fg2", "away", 101, 0, 2),
            (2, "10:00", "dreb", "away", 103, 0, 0),
            (2, "9:00", "fg2", "away", 106, 0, 2),
            (2, "8:00", "fg2", "home", 202, 0, 2),
            (2, "7:00", "dreb", "home", 203, 0, 0),
            (2, "6:00", "dreb", "home", 204, 0, 0),
            (2, "5:00", "dreb", "home", 205, 0, 0),
            (2, "4:00", "dreb", "home", 201, 0, 0)]
    rb = rebuild(rows, periods=2)
    assert lineup_at(rb.stints, 0, "away") == {101, 102, 103, 104, 105}
    assert lineup_at(rb.stints, 120, "away") == {101, 102, 103, 104, 106}
    assert lineup_at(rb.stints, 720, "away") == {101, 103, 104, 106, 107}  # 104 played the period without an event
    assert all(len(st.lineup[s]) == 5 for st in rb.stints for s in pbp.SIDES)
    assert sum(st.secs for st in rb.stints) == 1440


def test_corrected_substitution_kept_twice():
    """ESPN kept the original row (106 for 104) next to the corrected ones (107 for 104, 106 for 105)."""
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),
            (1, "6:00", "sub", "away", 106, 104, 0),
            (1, "6:00", "sub", "away", 107, 104, 0),
            (1, "6:00", "sub", "away", 106, 105, 0),
            (1, "5:00", "fg2", "away", 107, 0, 2),
            (1, "4:00", "fg2", "away", 106, 0, 2)]
    rb = rebuild(rows)
    assert lineup_at(rb.stints, 400, "away") == {101, 102, 103, 106, 107}
    assert rb.repaired == 1


def test_wrong_player_named_leaving():
    """A row names a player who already left (102); the player who really leaves is the one never seen again."""
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),
            (1, "9:00", "sub", "away", 106, 102, 0),  # 106 in for 102
            (1, "8:00", "fg2", "away", 106, 0, 2),
            (1, "6:00", "sub", "away", 107, 102, 0),  # should be 107 in for 106
            (1, "5:00", "fg2", "away", 101, 0, 2),
            (1, "4:00", "dreb", "away", 103, 0, 0),
            (1, "3:00", "dreb", "away", 104, 0, 0),
            (1, "2:00", "dreb", "away", 105, 0, 0),
            (1, "1:00", "fg2", "away", 107, 0, 2)]
    rb = rebuild(rows)
    assert lineup_at(rb.stints, 700, "away") == {101, 103, 104, 105, 107}
    on = secs_on(rb.stints)
    assert (on[102], on[106], on[107]) == (180.0, 180.0, 360.0)


def test_substitution_without_outgoing_player():
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),
            (1, "10:00", "dreb", "away", 102, 0, 0),
            (1, "9:00", "dreb", "away", 103, 0, 0),
            (1, "8:00", "dreb", "away", 104, 0, 0),
            (1, "6:00", "sub", "away", 106, 0, 0),  # nobody named leaving: 105 is never mentioned again
            (1, "5:00", "fg2", "away", 101, 0, 2),
            (1, "4:00", "dreb", "away", 102, 0, 0),
            (1, "3:00", "dreb", "away", 103, 0, 0),
            (1, "2:00", "dreb", "away", 104, 0, 0)]
    rb = rebuild(rows)
    assert lineup_at(rb.stints, 700, "away") == {101, 102, 103, 104, 106}


def test_equal_readings_take_the_box_minutes():
    """Period 2 names only four away players; 104 and 105 both sat silently. Box minutes say 105 played it."""
    rows = [(1, "11:00", "fg2", "away", 101, 0, 2),
            (1, "6:00", "sub", "away", 106, 105, 0),
            (1, "0.0", "end", "", 0, 0, 0),
            (2, "12:00", "sub", "away", 105, 106, 0),  # 105 comes back in at the start of the period...
            (2, "12:00", "sub", "away", 107, 104, 0),  # ...and 107 for 104, but this row is a duplicate of
            (2, "12:00", "sub", "away", 107, 105, 0),  # this one: one of them is wrong
            (2, "11:00", "fg2", "away", 101, 0, 2),
            (2, "10:00", "dreb", "away", 102, 0, 0),
            (2, "9:00", "dreb", "away", 103, 0, 0),
            (2, "8:00", "dreb", "away", 107, 0, 0)]
    short_105 = {101: 24, 102: 24, 103: 24, 104: 24, 105: 6, 106: 6, 107: 12}
    short_104 = {101: 24, 102: 24, 103: 24, 104: 12, 105: 18, 106: 6, 107: 12}
    a = rebuild(rows, periods=2, minutes=short_105)
    b = rebuild(rows, periods=2, minutes=short_104)
    assert lineup_at(a.stints, 800, "away") == {101, 102, 103, 104, 107}
    assert lineup_at(b.stints, 800, "away") == {101, 102, 103, 105, 107}
    assert a.tie_breaks == b.tie_breaks == 1


def test_free_throws_count_for_the_lineup_at_the_foul():
    """Home fouls at 5:00, then 106 replaces 105, then 101 makes two free throws: the box score's plus-minus credits
    them to 105, who was on the floor at the foul."""
    rows = [(1, "5:00", "foul", "home", 201, 0, 0),
            (1, "5:00", "sub", "away", 106, 105, 0),
            (1, "5:00", "ft", "away", 101, 0, 1),
            (1, "5:00", "ft", "away", 101, 0, 1),
            (1, "4:00", "fg2", "away", 106, 0, 2)]
    rb = rebuild(rows)
    pm = defaultdict(int)
    for st in rb.stints:
        for s in pbp.SIDES:
            for a in st.lineup[s]:
                pm[a] += int(st.box[s][pbp.PTS] - st.box[pbp.OTHER[s]][pbp.PTS])
    assert (pm[105], pm[106], pm[101]) == (2, 2, 4)


# ------------------------------------------------------------------ the fixture day


@pytest.fixture(scope="module")
def built():
    return run_day(DAY, source_dir=HOOPR, inputs_dir=INPUTS, use_espn=False, offline=True, write=False)


@pytest.fixture(scope="module")
def pb(built):
    assert built.pbp is not None
    return built.pbp


def test_fixture_covers_every_final(pb, built):
    ck = pb.checks
    assert ck["games"] == len({r["game_id"] for r in built.build.team_games}) == 92
    assert ck["no_pbp"] == ck["score_mismatch"] == ck["wrong_teams"] == []
    assert len(pb.game_flow) == 92 and {r["game_id"] for r in pb.lineup_games} == {r["game_id"] for r in pb.game_flow}


def test_lineup_minutes_add_up_to_240_plus_25_per_overtime(pb, built):
    ot = {g["id"]: g["ot"] for g in built.build.games if g["id"] in {r["game_id"] for r in pb.game_flow}}
    minutes = defaultdict(float)
    for r in pb.lineup_games:
        assert len(r["player_ids"]) == 5 and r["lineup_id"] == pbp.lineup_id(r["player_ids"])
        minutes[(r["game_id"], r["team_code"])] += 5 * r["secs"] / 60  # player minutes
    assert len(minutes) == 184
    for (gid, _), m in minutes.items():
        assert m == pytest.approx(240 + 25 * ot[gid], abs=0.05), gid
    assert sum(1 for v in ot.values() if v) == 4  # the check covers overtime games too
    assert pb.checks["lineup_minutes_bad"] == []


def test_minutes_match_the_box_score(pb):
    """Every player-game within a minute of the box score, except one game where ESPN's play-by-play misses
    substitutions (the same five players are off in plus-minus too, so the box knows lineups the feed does not)."""
    ck = pb.checks
    assert ck["player_games"] == 2079
    assert {(g, p) for g, p, _, _ in ck["minutes_off"]} == {
        (401909096, 4066259), (401909096, 4395630), (401909096, 5037871), (401909096, 4592479), (401909096, 5061568)}
    assert max(abs(ours - box) for _, _, box, ours in ck["minutes_off"]) < 3
    assert ck["not_in_box"] == []


def test_plus_minus_matches_the_box_score(pb, built):
    ck = pb.checks
    assert ck["pm_checked"] == 2079 and ck["pm_off"] / ck["pm_checked"] < 0.025
    # season totals: on-floor margin against the box score's plus-minus (397 of 442 players exact on this day)
    box = {r["player_id"]: r["pm_total"] for r in built.build.player_season}
    diffs = [r["pm"] - box[r["player_id"]] for r in pb.player_on_off]
    assert sum(d == 0 for d in diffs) / len(diffs) > 0.85
    assert max(abs(d) for d in diffs) <= 5


def test_flow_matches_the_box_score(pb, built):
    tg = {(r["game_id"], r["home_away"]): r for r in built.build.team_games}
    for f in pb.game_flow:
        a, h = tg[(f["game_id"], "away")], tg[(f["game_id"], "home")]
        assert (f["away"][-1], f["home"][-1]) == (a["pts"], h["pts"])
        assert f["away"] == sorted(f["away"]) and f["home"] == sorted(f["home"]) and f["t"] == sorted(f["t"])
        assert 0 < f["t"][-1] <= pbp.game_seconds(f["num_periods"])
        assert f["away_lead_secs"] + f["home_lead_secs"] + f["tied_secs"] == pytest.approx(pbp.game_seconds(f["num_periods"]))
        assert (f["away_largest_lead"], f["home_largest_lead"]) == (a["largest_lead"], h["largest_lead"])
        assert f["lead_changes"] == a["lead_changes"]
    # ten games had no lead change at all; the other 82 are compared in the run's own checks too
    assert pb.checks["lead_changes_checked"] == 82 and pb.checks["lead_changes_off"] == []


def test_runs_are_unanswered_in_the_fixture(pb):
    by_game = defaultdict(list)
    for r in pb.game_runs:
        by_game[r["game_id"]].append(r)
        mine = "away_after" if r["away_after"] > r["away_before"] else "home_after"
        other = "home" if mine == "away_after" else "away"
        assert r[f"{other}_after"] == r[f"{other}_before"]  # the other side did not score
        assert r[mine] - r[mine.replace("after", "before")] == r["pts"]
        assert r["end_t"] >= r["start_t"]
    for runs in by_game.values():
        assert sum(r["biggest"] for r in runs) == 2  # one biggest run per team
        assert all(r["pts"] >= pbp.RUN_MIN or r["biggest"] for r in runs)


def test_lineup_points_and_possessions_add_up(pb, built):
    tg = {(r["game_id"], r["team_code"]): r for r in built.build.team_games}
    sums = defaultdict(lambda: [0, 0, 0.0])
    for r in pb.lineup_games:
        s = sums[(r["game_id"], r["team_code"])]
        s[0] += r["pts"]
        s[1] += r["opp_pts"]
        s[2] += r["poss"]
    for key, (pts, opp, poss) in sums.items():
        assert (pts, opp) == (tg[key]["pts"], tg[key]["opp_pts"])
        assert poss == pytest.approx(tg[key]["poss"], abs=1.6)  # box rounding, plus a play the feed and box disagree on
    assert pb.checks["poss_gap_max"] <= 1.0


def test_on_and_off_split_his_games(pb, built):
    team_secs = defaultdict(float)
    for r in pb.lineup_games:
        team_secs[(r["game_id"], r["team_code"])] += r["secs"]
    for r in pb.player_on_off:
        assert r["on_secs"] > 0 and r["games"] >= 1
        assert r["on_secs"] + r["off_secs"] > 0
        if r["on_net"] is not None and r["off_net"] is not None:
            assert r["on_off"] == pytest.approx(r["on_net"] - r["off_net"], abs=0.11)
    # a player who played every second of his team's games has no off-floor time
    lineup_season = defaultdict(float)
    for r in pb.lineup_season:
        lineup_season[r["team_code"]] += r["secs"]
    for team, secs in lineup_season.items():
        assert secs == pytest.approx(sum(v for (g, t), v in team_secs.items() if t == team), abs=1)


def _independent_clutch_points(raw: pd.DataFrame) -> dict[tuple[int, int], int]:
    """Clutch points by (game, team id), counted straight from the raw rows with no shared code."""
    out: dict[tuple[int, int], int] = defaultdict(int)
    raw = raw.sort_values(["game_id", "game_play_number"])
    for gid, g in raw.groupby("game_id"):
        a = h = 0
        for r in g.itertuples(index=False):
            left = r.clock_minutes * 60 + r.clock_seconds
            if r.period_number >= 4 and left <= 300 and abs(a - h) <= 5 and r.scoring_play:
                out[(int(gid), int(r.team_id))] += int(r.score_value)
            a, h = r.away_score, r.home_score
    return out


def test_clutch_points_against_an_independent_count(pb, built):
    raw = pbp.read_plays(HOOPR / "play_by_play_2027.parquet")
    raw = raw[raw.game_date.astype(str) < DAY.isoformat()]
    espn_ids = {t["espn_id"]: t["code"] for t in built.build.teams}
    expected = defaultdict(int)
    for (gid, team_id), pts in _independent_clutch_points(raw).items():
        expected[espn_ids[team_id]] += pts
    got = {r["team_code"]: r["pts"] for r in pb.team_clutch}
    assert {k: v for k, v in expected.items() if v} == {k: v for k, v in got.items() if v}
    assert sum(got.values()) > 0


def test_clutch_tables_add_up(pb, built):
    players = defaultdict(int)
    for r in pb.player_clutch:
        players[r["team_code"]] += r["pts"]
        assert r["fgm"] <= r["fga"] and r["tpm"] <= r["tpa"] and r["ftm"] <= r["fta"]
        assert r["pts"] == 2 * r["fgm"] + r["tpm"] + r["ftm"]
    gp = {r["team_code"]: r["gp"] for r in built.build.team_season}
    for r in pb.team_clutch:
        assert r["pts"] == players[r["team_code"]]  # every clutch point has a scorer
        assert r["pm"] == r["pts"] - r["opp_pts"] and r["w"] + r["l"] == r["games"] <= gp[r["team_code"]]
        assert r["secs"] <= 300 * r["games"] + 300 * 4  # at most 5 minutes a game, plus overtimes
        mates = [p for p in pb.player_clutch if p["team_code"] == r["team_code"]]
        assert sum(p["secs"] for p in mates) == pytest.approx(5 * r["secs"], abs=1)  # five on the floor


def test_run_notes(built):
    warns = [w for w in built.warnings if w.startswith(pbp.PREFIX)]
    assert warns == [pbp.PREFIX + "5 of 2079 player-games differ from box-score minutes by more than a minute "
                     "(ESPN's play-by-play misses substitutions in games [401909096])"]
    assert built.errors == []
