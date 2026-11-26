BEGIN;

CREATE TYPE "PaymentDocumentKind" AS ENUM ('PROOF', 'RECEIPT', 'QUARANTINED');

ALTER TABLE "Upload"
    ADD COLUMN "paymentKind" "PaymentDocumentKind",
    ADD COLUMN "paymentInvoiceId" TEXT;

-- Resolve legacy references without modifying invoices or deleting files.
-- Only a unique canonical reference with the expected owner establishes scope.
WITH refs AS (
    SELECT i.id AS invoice_id, d.kind, d.url, d.owner_id,
           substring(btrim(d.url) FROM '^(?:https?://[^/]+)?/api/files/([^?#]+)') AS raw_key
    FROM "Invoice" i
    JOIN "Student" s ON s.id = i."studentId"
    CROSS JOIN LATERAL (VALUES
        ('PROOF', i."proofFile", s."userId"),
        ('RECEIPT', i."receiptFile", s."teacherId")
    ) AS d(kind, url, owner_id)
    WHERE d.url IS NOT NULL
), normalized AS (
    SELECT refs.*, (
        SELECT string_agg(
            CASE WHEN length(part[1]) = 3 THEN
                CASE WHEN get_byte(decode(substr(part[1], 2), 'hex'), 0) BETWEEN 32 AND 126
                     THEN chr(get_byte(decode(substr(part[1], 2), 'hex'), 0))
                     ELSE part[1] END
            ELSE part[1] END,
            '' ORDER BY n)
        FROM regexp_matches(raw_key, '%[0-9A-Fa-f]{2}|.', 'g') WITH ORDINALITY AS chars(part, n)
    ) AS decoded_key
    FROM refs
), matches AS (
    SELECT u.id, n.invoice_id, n.kind, n.url, n.owner_id
    FROM normalized n JOIN "Upload" u ON u.path = n.decoded_key OR u.path = n.raw_key
    UNION
    -- Generated legacy names are random and unique in practice. A matching
    -- name in a malformed path is evidence to close access, not to grant it.
    SELECT u.id, n.invoice_id, n.kind, n.url, n.owner_id
    FROM normalized n
    JOIN "Upload" u ON substring(u.path FROM '[^/]+$') = substring(n.decoded_key FROM '[^/]+$')
    WHERE u.path ~ '^[0-9]{4}/[0-9]{2}/[A-Za-z0-9_-]{24}\.[a-z0-9]+$'
), ownership AS (
    SELECT m.id, min(m.invoice_id) AS invoice_id, min(m.kind) AS kind,
           count(*) = 1 AND bool_and(m.owner_id IS NOT NULL AND m.owner_id = u."ownerId"
               AND m.url = '/api/files/' || u.path) AS confirmed
    FROM matches m JOIN "Upload" u ON u.id = m.id
    GROUP BY m.id
)
UPDATE "Upload" u
SET "paymentKind" = CASE WHEN o.confirmed THEN o.kind::"PaymentDocumentKind" ELSE 'QUARANTINED' END,
    "paymentInvoiceId" = CASE WHEN o.confirmed THEN o.invoice_id END
FROM ownership o WHERE u.id = o.id;

ALTER TABLE "Upload" ADD CONSTRAINT "Upload_payment_scope_check" CHECK (
    ("paymentInvoiceId" IS NOT NULL) = COALESCE("paymentKind" IN ('PROOF', 'RECEIPT'), false)
);

COMMIT;
