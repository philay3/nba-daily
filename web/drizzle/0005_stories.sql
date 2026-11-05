CREATE TABLE "player_baselines" (
	"season" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"stat" text NOT NULL,
	"team_code" text NOT NULL,
	"as_of" date NOT NULL,
	"gp" integer NOT NULL,
	"mean" double precision,
	"sd" double precision,
	"l10_gp" integer NOT NULL,
	"l10_mean" double precision,
	"l10_sd" double precision,
	CONSTRAINT "player_baselines_season_player_id_stat_pk" PRIMARY KEY("season","player_id","stat")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"story_date" date NOT NULL,
	"rank" integer NOT NULL,
	"story_id" text NOT NULL,
	"season" integer NOT NULL,
	"kind" text NOT NULL,
	"subtype" text NOT NULL,
	"player_id" bigint,
	"team_code" text NOT NULL,
	"opp_code" text NOT NULL,
	"game_id" integer NOT NULL,
	"headline" text NOT NULL,
	"detail" text NOT NULL,
	"value" double precision,
	"baseline" double precision,
	"sd" double precision,
	"z" double precision,
	"games" integer,
	"rarity" double precision NOT NULL,
	"prominence" double precision NOT NULL,
	"score" double precision NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "stories_story_date_rank_pk" PRIMARY KEY("story_date","rank")
);
--> statement-breakpoint
ALTER TABLE "player_baselines" ADD CONSTRAINT "player_baselines_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_baselines" ADD CONSTRAINT "player_baselines_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_season_idx" ON "stories" USING btree ("season");--> statement-breakpoint
CREATE INDEX "stories_player_idx" ON "stories" USING btree ("player_id");