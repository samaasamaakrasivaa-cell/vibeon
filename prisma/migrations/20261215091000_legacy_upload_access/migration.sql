BEGIN;

ALTER TABLE "Upload" ADD COLUMN "legacyUnverified" BOOLEAN NOT NULL DEFAULT false;

-- Only persisted references used by the application count. Reusing a URL in
-- text, a filename, a MIME type or uploader role alone does not prove purpose.
WITH course_lessons AS (
    SELECT l.id, l.cover, c."teacherId"
    FROM "LessonTemplate" l
    JOIN "Unit" un ON un.id = l."unitId"
    JOIN "Course" c ON c.id = un."courseId"
), task_media AS (
    SELECT lesson."teacherId" AS owner_id, t.type, t.options
    FROM "Task" t JOIN course_lessons lesson ON lesson.id = t."templateId"
), owner_references(owner_id, url, media) AS (
    SELECT "teacherId", cover, 'image' FROM "Course"
    UNION ALL
    SELECT "teacherId", cover, 'image' FROM course_lessons
    UNION ALL
    SELECT "userId", avatar, 'image' FROM "Student" WHERE "userId" IS NOT NULL
    UNION ALL
    SELECT "userId", about->>'photo', 'image' FROM "TeacherProfile"
    UNION ALL
    SELECT owner_id, options->>'src', type FROM task_media WHERE type IN ('audio', 'video')
    UNION ALL
    SELECT owner_id, options->>'url', NULL FROM task_media WHERE type = 'link'
    UNION ALL
    SELECT t.owner_id, image.value->>'src', 'image'
    FROM task_media t
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.options->'images') = 'array' THEN t.options->'images' ELSE '[]'::jsonb END
    ) image
    WHERE t.type IN ('image', 'text', 'textorder')
    UNION ALL
    SELECT t.owner_id, src.value, 'image'
    FROM task_media t
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(t.options->'pics') = 'array' THEN t.options->'pics' ELSE '[]'::jsonb END
    ) src
    WHERE t.type = 'picture'
), board_images AS (
    SELECT l."teacherId", l."studentId", l."slotId", item.value->>'src' AS url
    FROM "LessonInstance" l
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(l.board->'pages') = 'array' THEN l.board->'pages' ELSE '[]'::jsonb END
    ) page
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(page.value) = 'array' THEN page.value ELSE '[]'::jsonb END
    ) item
    WHERE item.value->>'t' = 'image'
), verified_uploads AS (
    SELECT u.id
    FROM owner_references r
    JOIN "Upload" u
        ON u.path = substring(r.url FROM '^/api/files/([^?#]+)')
        AND u."ownerId" = r.owner_id
        AND (r.media IS NULL OR u.mime LIKE r.media || '/%')
    UNION
    SELECT u.id
    FROM board_images b
    JOIN "Upload" u ON u.path = substring(b.url FROM '^/api/files/([^?#]+)') AND u.mime LIKE 'image/%'
    WHERE u."ownerId" = b."teacherId" OR EXISTS (
        SELECT 1 FROM "Student" s
        WHERE s."userId" = u."ownerId" AND (
            s.id = b."studentId" OR EXISTS (
                SELECT 1 FROM "LessonInstance" member
                WHERE member."slotId" = b."slotId" AND member."teacherId" = b."teacherId" AND member."studentId" = s.id
            )
        )
    )
    UNION
    SELECT u.id FROM "AiImage" i
    JOIN "Upload" u ON u.path = substring(i.url FROM '^/api/files/([^?#]+)') AND u.mime LIKE 'image/%'
    UNION
    SELECT u.id FROM "PlacementEdit" p JOIN "Upload" u ON u.path = p.audio AND u.mime LIKE 'audio/%'
    UNION
    SELECT u.id
    FROM "PlacementAttempt" p
    CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(p.state->'items') = 'object' THEN p.state->'items' ELSE '{}'::jsonb END
    ) item
    JOIN "Upload" u ON u.path = substring(item.value->>'audio' FROM '^/api/files/([^?#]+)') AND u.mime LIKE 'audio/%'
    WHERE item.value->>'type' = 'listening'
)
UPDATE "Upload" u
SET "legacyUnverified" = true
WHERE u."paymentKind" IS NULL
  AND NOT EXISTS (SELECT 1 FROM verified_uploads v WHERE v.id = u.id);

COMMIT;
