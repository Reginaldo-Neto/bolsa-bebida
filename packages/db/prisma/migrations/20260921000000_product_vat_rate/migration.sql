-- L6: every invoice line carries its own VAT rate. Portuguese catering taxes
-- alcoholic drinks at the standard rate and most non-alcoholic ones at the
-- intermediate rate, so this cannot be one global setting.
--
-- Stored in basis points (2300 = 23%) rather than a decimal, for the same
-- reason money is stored in cents: no floats anywhere near an invoice.
ALTER TABLE "products" ADD COLUMN "vat_basis_points" INTEGER NOT NULL DEFAULT 2300;

ALTER TABLE "products"
  ADD CONSTRAINT "products_vat_basis_points_check"
  CHECK ("vat_basis_points" >= 0 AND "vat_basis_points" <= 10000);

-- Non-alcoholic drinks default to the intermediate rate; the organiser can
-- correct any of these from the admin panel before the event.
UPDATE "products" SET "vat_basis_points" = 1300 WHERE "is_alcoholic" = false;
