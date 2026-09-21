-- The till: a bar also takes notes and cards on its own terminal, and those
-- sales have to move the same stock, the same prices and the same fiscal
-- documents as the ones the application settles itself.

-- A third thing a bar account can be, alongside STAFF (who hands drinks over)
-- and ADMIN (who runs the event).
ALTER TYPE "StaffRole" ADD VALUE 'CASHIER';

CREATE TYPE "PaymentMethod" AS ENUM ('MBWAY', 'CASH', 'CARD_TERMINAL');

-- Every order that existed before the till did was paid through MB WAY.
ALTER TABLE "orders"
  ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'MBWAY',
  ADD COLUMN "sold_by_staff_id" TEXT,
  ADD COLUMN "cash_received_cents" INTEGER;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_sold_by_staff_id_fkey"
  FOREIGN KEY ("sold_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_sold_by_staff_id_created_at_idx"
  ON "orders"("sold_by_staff_id", "created_at");

-- Notes handed over are only meaningful for a cash sale, and a till that
-- recorded receiving less than the total would be a drawer that cannot be
-- counted. Both are refused by the database rather than trusted to the app.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cash_received_check"
  CHECK (
    ("payment_method" = 'CASH' AND "cash_received_cents" >= "total_cents")
    OR ("payment_method" <> 'CASH' AND "cash_received_cents" IS NULL)
  );

-- A sale at the till still belongs to a customer, one per sale: the limits of
-- L8 are per person, and folding every counter sale into a single row would
-- make the whole till hit the alcohol cap after a handful of drinks.
ALTER TABLE "participants"
  ADD COLUMN "is_counter" BOOLEAN NOT NULL DEFAULT false;
