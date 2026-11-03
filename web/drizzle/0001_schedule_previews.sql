CREATE TABLE "game_previews" (
	"snapshot_date" date NOT NULL,
	"game_id" integer NOT NULL,
	"game_code" text NOT NULL,
	"game_date" date NOT NULL,
	"days_ahead" integer NOT NULL,
	"away_code" text NOT NULL,
	"home_code" text NOT NULL,
	"away_w" integer NOT NULL,
	"away_l" integer NOT NULL,
	"home_w" integer NOT NULL,
	"home_l" integer NOT NULL,
	"away_rest" integer,
	"home_rest" integer,
	"away_b2b" boolean NOT NULL,
	"home_b2b" boolean NOT NULL,
	"away_b2b_next" boolean NOT NULL,
	"home_b2b_next" boolean NOT NULL,
	"injury_report" date,
	"away_out" integer,
	"home_out" integer,
	"away_missing_ppg" double precision,
	"home_missing_ppg" double precision,
	CONSTRAINT "game_previews_snapshot_date_game_id_pk" PRIMARY KEY("snapshot_date","game_id")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "time_valid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "game_previews" ADD CONSTRAINT "game_previews_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_previews" ADD CONSTRAINT "game_previews_away_code_teams_code_fk" FOREIGN KEY ("away_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_previews" ADD CONSTRAINT "game_previews_home_code_teams_code_fk" FOREIGN KEY ("home_code") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_previews_date_idx" ON "game_previews" USING btree ("game_date");