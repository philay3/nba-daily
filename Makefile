# Common tasks. Both the pipeline and the web app read DATABASE_URL from .env at the repo root.
PY ?= python3
NPM ?= npm --prefix web
DATE ?= $(shell TZ=America/New_York date +%F)

.PHONY: help install db-up db-down migrate seed run digest export test web build check smoke

help:
	@echo "install   install pipeline (editable, with dev extras) and web dependencies"
	@echo "db-up     start the local Postgres 16 container (docker compose)"
	@echo "migrate   apply the SQL migrations in web/drizzle to DATABASE_URL"
	@echo "seed      load the bundled fixture day (2026-11-02) so the app has data offline"
	@echo "run       run the daily pipeline for DATE (default: today in New York)"
	@echo "digest    print the fact sheet for DATE"
	@echo "export    write the ten dashboard JSON files for DATE to exports/DATE"
	@echo "test      pytest (parity, ESPN parsers, DB load)"
	@echo "web       start the Next.js dev server on http://localhost:3000"
	@echo "check     test + typecheck + lint + build"
	@echo "smoke     Playwright smoke test against a running app (BASE_URL, default http://localhost:3000)"

install:
	$(PY) -m pip install -e "pipeline[dev]"
	$(NPM) ci

db-up:
	docker compose up -d db

db-down:
	docker compose down

migrate:
	$(PY) -m nba_pipeline migrate

seed: migrate
	$(PY) -m nba_pipeline seed

run:
	$(PY) -m nba_pipeline run --date $(DATE)

digest:
	$(PY) -m nba_pipeline digest --date $(DATE)

export:
	$(PY) -m nba_pipeline export-json --date $(DATE) --out exports/$(DATE)

test:
	cd pipeline && $(PY) -m pytest -q

web:
	$(NPM) run dev

build:
	$(NPM) run build

check: test
	$(NPM) run typecheck
	$(NPM) run lint
	$(NPM) run build

smoke:
	$(NPM) run smoke
