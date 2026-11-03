CREATE TABLE "game_shot_zones" (
	"game_id" integer NOT NULL,
	"team_code" text NOT NULL,
	"zone" text NOT NULL,
	"fga" integer NOT NULL,
	"fgm" integer NOT NULL,
	"pts" integer NOT NULL,
	"ast" integer NOT NULL,
	"fg_pct" double precision,
	"pps" double precision,
	"share" double precision,
	"ast_pct" double precision,
	"lg_fg_pct" double precision,
	"lg_pps" double precision,
	"lg_share" double precision,
	"fg_pct_diff" double precision,
	CONSTRAINT "game_shot_zones_game_id_team_code_zone_pk" PRIMARY KEY("game_id","team_code","zone")
);
--> statement-breakpoint
CREATE TABLE "league_shot_zones" (
	"season" integer NOT NULL,
	"zone" text NOT NULL,
	"as_of" date NOT NULL,
	"fga" integer NOT NULL,
	"fgm" integer NOT NULL,
	"pts" integer NOT NULL,
	"ast" integer NOT NULL,
	"fg_pct" double precision,
	"pps" double precision,
	"share" double precision,
	"ast_pct" double precision,
	CONSTRAINT "league_shot_zones_season_zone_pk" PRIMARY KEY("season","zone")
);
--> statement-breakpoint
CREATE TABLE "player_shot_zones" (
	"season" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"zone" text NOT NULL,
	"team_code" text,
	"as_of" date NOT NULL,
	"fga" integer NOT NULL,
	"fgm" integer NOT NULL,
	"pts" integer NOT NULL,
	"ast" integer NOT NULL,
	"fg_pct" double precision,
	"pps" double precision,
	"share" double precision,
	"ast_pct" double precision,
	"lg_fg_pct" double precision,
	"lg_pps" double precision,
	"lg_share" double precision,
	"fg_pct_diff" double precision,
	CONSTRAINT "player_shot_zones_season_player_id_zone_pk" PRIMARY KEY("season","player_id","zone")
);
--> statement-breakpoint
CREATE TABLE "shot_games" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"shots" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"game_id" integer NOT NULL,
	"seq" smallint NOT NULL,
	"season" integer NOT NULL,
	"game_date" date NOT NULL,
	"period" smallint NOT NULL,
	"clock" text NOT NULL,
	"team_code" text NOT NULL,
	"opp_code" text NOT NULL,
	"player_id" bigint NOT NULL,
	"assist_id" bigint,
	"shot_type" text NOT NULL,
	"made" boolean NOT NULL,
	"points" smallint NOT NULL,
	"three" boolean NOT NULL,
	"x" smallint NOT NULL,
	"y" smallint NOT NULL,
	"distance" double precision NOT NULL,
	"zone" text NOT NULL,
	"assisted" boolean NOT NULL,
	CONSTRAINT "shots_game_id_seq_pk" PRIMARY KEY("game_id","seq")
);
--> statement-breakpoint
CREATE TABLE "team_shot_zones" (
	"season" integer NOT NULL,
	"team_code" text NOT NULL,
	"side" text NOT NULL,
	"zone" text NOT NULL,
	"as_of" date NOT NULL,
	"fga" integer NOT NULL,
	"fgm" integer NOT NULL,
	"pts" integer NOT NULL,
	"ast" integer NOT NULL,
	"fg_pct" double precision,
	"pps" double precision,
	"share" double precision,
	"ast_pct" double precision,
	"lg_fg_pct" double precision,
	"lg_pps" double precision,
	"lg_share" double precision,
	"fg_pct_diff" double precision,
	CONSTRAINT "team_shot_zones_season_team_code_side_zone_pk" PRIMARY KEY("season","team_code","side","zone")
);
--> statement-breakpoint
ALTER TABLE "game_shot_zones" ADD CONSTRAINT "game_shot_zones_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_shot_zones" ADD CONSTRAINT "game_shot_zones_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_shot_zones" ADD CONSTRAINT "player_shot_zones_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_shot_zones" ADD CONSTRAINT "player_shot_zones_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_games" ADD CONSTRAINT "shot_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_opp_code_teams_code_fk" FOREIGN KEY ("opp_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_shot_zones" ADD CONSTRAINT "team_shot_zones_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_games_season_idx" ON "shot_games" USING btree ("season");--> statement-breakpoint
CREATE INDEX "shots_player_idx" ON "shots" USING btree ("season","player_id");--> statement-breakpoint
CREATE INDEX "shots_team_idx" ON "shots" USING btree ("season","team_code");--> statement-breakpoint
CREATE INDEX "shots_opp_idx" ON "shots" USING btree ("season","opp_code");