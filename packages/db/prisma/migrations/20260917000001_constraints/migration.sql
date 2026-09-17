-- Invariants of spec 9, enforced by the database rather than trusted to the
-- application. If a bug ever tries to oversell stock or redeem a voucher twice,
-- the transaction aborts instead of corrupting the event.

-- Prices: min <= base <= max, and nothing is free by accident.
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_range_check"
  CHECK ("min_price_cents" <= "base_price_cents" AND "base_price_cents" <= "max_price_cents");

ALTER TABLE "products"
  ADD CONSTRAINT "products_min_price_positive_check"
  CHECK ("min_price_cents" > 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_cost_non_negative_check"
  CHECK ("cost_cents" >= 0);

-- Stock counters never go negative (spec 4.2).
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative_check"
  CHECK (
    "stock_initial" >= 0
    AND "stock_available" >= 0
    AND "stock_reserved" >= 0
    AND "stock_sold" >= 0
  );

-- A unit is either available, reserved or sold: the three buckets cannot add up
-- to more than what was brought to the party.
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_conservation_check"
  CHECK ("stock_available" + "stock_reserved" + "stock_sold" <= "stock_initial");

-- Redemption can never exceed what was bought (spec 6.3 step 6).
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_qty_positive_check"
  CHECK ("qty" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_redeemed_within_qty_check"
  CHECK ("redeemed_qty" >= 0 AND "redeemed_qty" <= "qty");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_prices_positive_check"
  CHECK ("unit_price_cents" > 0 AND "base_price_cents_at_purchase" > 0);

ALTER TABLE "redemptions"
  ADD CONSTRAINT "redemptions_qty_positive_check"
  CHECK ("qty" > 0);

-- Money is never negative.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_non_negative_check"
  CHECK ("total_cents" >= 0);

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_total_non_negative_check"
  CHECK ("total_cents" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_non_negative_check"
  CHECK ("amount_cents" >= 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive_check"
  CHECK ("amount_cents" > 0);

ALTER TABLE "price_ticks"
  ADD CONSTRAINT "price_ticks_price_positive_check"
  CHECK ("price_cents" > 0);

ALTER TABLE "price_ticks"
  ADD CONSTRAINT "price_ticks_paid_units_non_negative_check"
  CHECK ("paid_units" >= 0);

-- The engine state must stay inside the product's published range (L2).
ALTER TABLE "product_engine_state"
  ADD CONSTRAINT "product_engine_state_price_positive_check"
  CHECK ("current_price_cents" > 0);

-- The audit log is append-only (spec 4.7).
CREATE RULE "audit_log_no_update" AS ON UPDATE TO "audit_log" DO INSTEAD NOTHING;
CREATE RULE "audit_log_no_delete" AS ON DELETE TO "audit_log" DO INSTEAD NOTHING;
