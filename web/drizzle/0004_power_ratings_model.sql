CREATE TABLE "model_backtest" (
	"season" integer PRIMARY KEY NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"line_games" integer NOT NULL,
	"model_mae_all" double precision,
	"model_mae" double precision,
	"line_mae" double precision,
	"ats_w" integer NOT NULL,
	"ats_l" integer NOT NULL,
	"ats_p" integer NOT NULL,
	"su_games" integer NOT NULL,
	"su_right" integer NOT NULL,
	"line_su_games" integer NOT NULL,
	"line_su_right" integer NOT NULL,
	"model_su_on_line_games" integer NOT NULL,
	"brier" double precision,
	"home_court" double precision,
	"sigma" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_calibration" (
	"season" integer NOT NULL,
	"lo" integer NOT NULL,
	"hi" integer NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"mean_wp" double precision,
	"win_pct" double precision,
	CONSTRAINT "model_calibration_season_lo_pk" PRIMARY KEY("season","lo")
);
--> statement-breakpoint
CREATE TABLE "model_days" (
	"season" integer NOT NULL,
	"as_of" date NOT NULL,
	"games" integer NOT NULL,
	"league_ortg" double precision,
	"home_court" double precision,
	"sigma" double precision,
	"sigma_games" integer NOT NULL,
	"pace" double precision,
	CONSTRAINT "model_days_season_as_of_pk" PRIMARY KEY("season","as_of")
);
--> statement-breakpoint
CREATE TABLE "model_games" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"game_date" date NOT NULL,
	"as_of" date NOT NULL,
	"fit_games" integer NOT NULL,
	"away_code" text NOT NULL,
	"home_code" text NOT NULL,
	"away_rest" integer,
	"home_rest" integer,
	"poss" double precision,
	"home_court" double precision,
	"rest_adj" double precision,
	"pred_margin" double precision,
	"home_wp" double precision,
	"sigma" double precision,
	"line_margin" double precision,
	"line_source" text,
	"actual_margin" integer,
	"pick" text,
	"ats" text
);
--> statement-breakpoint
CREATE TABLE "power_ratings" (
	"season" integer NOT NULL,
	"as_of" date NOT NULL,
	"team_code" text NOT NULL,
	"games" integer NOT NULL,
	"adj_ortg" double precision,
	"adj_drtg" double precision,
	"adj_net" double precision,
	"ortg_rk" integer,
	"drtg_rk" integer,
	"net_rk" integer,
	"ortg" double precision,
	"drtg" double precision,
	"net" double precision,
	"pace" double precision,
	CONSTRAINT "power_ratings_season_as_of_team_code_pk" PRIMARY KEY("season","as_of","team_code")
);
--> statement-breakpoint
ALTER TABLE "model_games" ADD CONSTRAINT "model_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_games" ADD CONSTRAINT "model_games_away_code_teams_code_fk" FOREIGN KEY ("away_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_games" ADD CONSTRAINT "model_games_home_code_teams_code_fk" FOREIGN KEY ("home_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_ratings" ADD CONSTRAINT "power_ratings_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_games_date_idx" ON "model_games" USING btree ("season","game_date");--> statement-breakpoint
CREATE INDEX "power_ratings_team_idx" ON "power_ratings" USING btree ("season","team_code");