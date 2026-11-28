BEGIN;
ALTER TABLE "Pack" ADD COLUMN "used" BOOLEAN NOT NULL DEFAULT false;
-- Existing balances provide evidence of use. Historical charges already
-- returned before this migration do not retain a reliable pack identifier.
UPDATE "Pack" SET "used" = true WHERE "lessonsLeft" <> "lessonsTotal";
COMMIT;
