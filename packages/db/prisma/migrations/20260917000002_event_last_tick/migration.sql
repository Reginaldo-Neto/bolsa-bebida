-- The engine needs to know which sales belong to the tick it is computing.
-- Without this the worker would have to re-derive the window from price_ticks
-- on every run, and a restart with no ticks yet would have no window at all.
ALTER TABLE "events" ADD COLUMN "last_tick_at" TIMESTAMPTZ(3);
