CREATE TABLE "game_flow" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"num_periods" integer NOT NULL,
	"t" double precision[] NOT NULL,
	"away" integer[] NOT NULL,
	"home" integer[] NOT NULL,
	"lead_changes" integer NOT NULL,
	"times_tied" integer NOT NULL,
	"away_largest_lead" integer NOT NULL,
	"home_largest_lead" integer NOT NULL,
	"away_lead_secs" double precision,
	"home_lead_secs" double precision,
	"tied_secs" double precision,
	"clutch_secs" double precision,
	"stints" integer NOT NULL,
	"lineup_repairs" integer NOT NULL,
	"minutes_off" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_runs" (
	"game_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"team_code" text NOT NULL,
	"pts" integer NOT NULL,
	"plays" integer NOT NULL,
	"start_t" double precision NOT NULL,
	"end_t" double precision NOT NULL,
	"start_period" integer NOT NULL,
	"start_clock" text NOT NULL,
	"end_period" integer NOT NULL,
	"end_clock" text NOT NULL,
	"away_before" integer NOT NULL,
	"home_before" integer NOT NULL,
	"away_after" integer NOT NULL,
	"home_after" integer NOT NULL,
	"biggest" boolean NOT NULL,
	CONSTRAINT "game_runs_game_id_seq_pk" PRIMARY KEY("game_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lineup_games" (
	"game_id" integer NOT NULL,
	"team_code" text NOT NULL,
	"lineup_id" text NOT NULL,
	"player_ids" bigint[] NOT NULL,
	"secs" double precision NOT NULL,
	"poss" double precision NOT NULL,
	"pts" integer NOT NULL,
	"opp_pts" integer NOT NULL,
	CONSTRAINT "lineup_games_game_id_team_code_lineup_id_pk" PRIMARY KEY("game_id","team_code","lineup_id")
);
--> statement-breakpoint
CREATE TABLE "lineup_season" (
	"season" integer NOT NULL,
	"team_code" text NOT NULL,
	"lineup_id" text NOT NULL,
	"player_ids" bigint[] NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"secs" double precision NOT NULL,
	"poss" double precision NOT NULL,
	"pts" integer NOT NULL,
	"opp_pts" integer NOT NULL,
	"ortg" double precision,
	"drtg" double precision,
	"net" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineup_season_season_team_code_lineup_id_pk" PRIMARY KEY("season","team_code","lineup_id")
);
--> statement-breakpoint
CREATE TABLE "player_clutch" (
	"season" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"team_code" text NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"secs" double precision NOT NULL,
	"pts" integer NOT NULL,
	"fgm" integer NOT NULL,
	"fga" integer NOT NULL,
	"fg_pct" double precision,
	"tpm" integer NOT NULL,
	"tpa" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"pm" integer NOT NULL,
	"poss" double precision NOT NULL,
	"ortg" double precision,
	"drtg" double precision,
	"net" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_clutch_season_player_id_team_code_pk" PRIMARY KEY("season","player_id","team_code")
);
--> statement-breakpoint
CREATE TABLE "player_on_off" (
	"season" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"team_code" text NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"on_secs" double precision NOT NULL,
	"on_poss" double precision NOT NULL,
	"on_pts" integer NOT NULL,
	"on_opp_pts" integer NOT NULL,
	"on_ortg" double precision,
	"on_drtg" double precision,
	"on_net" double precision,
	"off_secs" double precision NOT NULL,
	"off_poss" double precision NOT NULL,
	"off_pts" integer NOT NULL,
	"off_opp_pts" integer NOT NULL,
	"off_ortg" double precision,
	"off_drtg" double precision,
	"off_net" double precision,
	"on_off" double precision,
	"pm" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_on_off_season_player_id_team_code_pk" PRIMARY KEY("season","player_id","team_code")
);
--> statement-breakpoint
CREATE TABLE "team_clutch" (
	"season" integer NOT NULL,
	"team_code" text NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"w" integer NOT NULL,
	"l" integer NOT NULL,
	"secs" double precision NOT NULL,
	"poss" double precision NOT NULL,
	"pts" integer NOT NULL,
	"opp_pts" integer NOT NULL,
	"ortg" double precision,
	"drtg" double precision,
	"net" double precision,
	"pm" integer NOT NULL,
	"fgm" integer NOT NULL,
	"fga" integer NOT NULL,
	"fg_pct" double precision,
	"tpm" integer NOT NULL,
	"tpa" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_clutch_season_team_code_pk" PRIMARY KEY("season","team_code")
);
--> statement-breakpoint
ALTER TABLE "game_flow" ADD CONSTRAINT "game_flow_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_runs" ADD CONSTRAINT "game_runs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_runs" ADD CONSTRAINT "game_runs_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_games" ADD CONSTRAINT "lineup_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_games" ADD CONSTRAINT "lineup_games_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_season" ADD CONSTRAINT "lineup_season_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_clutch" ADD CONSTRAINT "player_clutch_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_clutch" ADD CONSTRAINT "player_clutch_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_on_off" ADD CONSTRAINT "player_on_off_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_on_off" ADD CONSTRAINT "player_on_off_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_clutch" ADD CONSTRAINT "team_clutch_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lineup_games_team_idx" ON "lineup_games" USING btree ("team_code");--> statement-breakpoint
CREATE INDEX "player_clutch_team_idx" ON "player_clutch" USING btree ("season","team_code");--> statement-breakpoint
CREATE INDEX "player_on_off_team_idx" ON "player_on_off" USING btree ("season","team_code");