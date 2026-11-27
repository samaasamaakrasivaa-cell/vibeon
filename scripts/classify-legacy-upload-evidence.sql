-- Apply an already reviewed inventory using psql -X -f <this script> < inventory.csv.
-- CSV order: upload_id,path,owner_id,disposition,evidence_reference
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE reviewed_uploads (
    upload_id text PRIMARY KEY,
    path text NOT NULL,
    owner_id text NOT NULL,
    disposition text NOT NULL CHECK (disposition IN ('financial', 'educational')),
    evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) > 0)
) ON COMMIT DROP;

\copy reviewed_uploads (upload_id, path, owner_id, disposition, evidence_reference) FROM PSTDIN WITH (FORMAT csv, HEADER MATCH)

DO $$
BEGIN
    PERFORM u.id FROM "Upload" u JOIN reviewed_uploads r ON r.upload_id = u.id
        ORDER BY u.id FOR UPDATE OF u;

    IF EXISTS (
        SELECT 1 FROM reviewed_uploads r
        LEFT JOIN "Upload" u ON u.id = r.upload_id AND u.path = r.path AND u."ownerId" = r.owner_id
        WHERE u.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Reviewed inventory does not match the current upload identity';
    END IF;

    IF EXISTS (
        SELECT 1 FROM reviewed_uploads r JOIN "Upload" u ON r.upload_id = u.id
        WHERE r.disposition = 'educational' AND (
            u."paymentKind" IS NOT NULL OR EXISTS (
                SELECT 1 FROM "Invoice" i
                WHERE i."proofFile" = '/api/files/' || u.path OR i."receiptFile" = '/api/files/' || u.path
            )
        )
    ) THEN
        RAISE EXCEPTION 'An educational classification conflicts with financial evidence';
    END IF;
END $$;

-- The historical financial inventory contains retired links and conflicts.
-- A current association does not resolve a conflict found in history.
UPDATE "Upload" u
SET "paymentKind" = 'QUARANTINED', "paymentInvoiceId" = NULL, "legacyUnverified" = false
FROM reviewed_uploads r
WHERE r.upload_id = u.id AND r.disposition = 'financial'
  AND (u."paymentKind" IS DISTINCT FROM 'QUARANTINED' OR u."legacyUnverified");

UPDATE "Upload" u SET "legacyUnverified" = false
FROM reviewed_uploads r
WHERE r.upload_id = u.id AND r.disposition = 'educational'
  AND u."legacyUnverified" AND u."paymentKind" IS NULL;

COMMIT;
