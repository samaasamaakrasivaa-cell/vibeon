INSERT INTO "User" (id, email, name, role, "updatedAt") VALUES
    ('teacher-a', 'a-teacher@example.invalid', 'Teacher A', 'TEACHER', now()),
    ('teacher-b', 'b-teacher@example.invalid', 'Teacher B', 'TEACHER', now()),
    ('student-a', 'a-student@example.invalid', 'Student A', 'STUDENT', now()),
    ('student-b', 'b-student@example.invalid', 'Student B', 'STUDENT', now());
UPDATE "User" SET "isAdmin" = true WHERE id = 'teacher-b';

INSERT INTO "TeacherProfile" ("userId") VALUES ('teacher-a'), ('teacher-b');
INSERT INTO "Student" (id, "userId", "teacherId", name, status, "updatedAt") VALUES
    ('record-a', 'student-a', 'teacher-a', 'Student A', 'ACTIVE', now()),
    ('record-b', 'student-b', 'teacher-b', 'Student B', 'ACTIVE', now());

INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt")
SELECT 'session-' || id, id, encode(sha256(convert_to('fixture-' || id, 'UTF8')), 'hex'), now() + interval '1 day'
FROM "User";

INSERT INTO "Upload" (id, "ownerId", path, name, mime, size)
SELECT id, owner, '2026/11/' || repeat(key, 24) || '.png', 'attachment.png', 'image/png', :fixture_size
FROM (VALUES
    ('legacy-receipt', 'teacher-a', 'A'),
    ('legacy-foreign', 'student-b', 'B'),
    ('legacy-alias', 'teacher-a', 'C'),
    ('learning-image', 'teacher-a', 'D'),
    ('legacy-proof', 'student-a', 'E'),
    ('legacy-duplicate', 'teacher-a', 'F'),
    ('legacy-detached', 'teacher-a', 'G'),
    ('legacy-unknown', 'teacher-a', 'H'),
    ('legacy-unresolved', 'teacher-a', 'K'),
    ('legacy-conflicting-history', 'teacher-a', 'L')
) AS uploads(id, owner, key);

INSERT INTO "Invoice" (id, "studentId", amount, title, status, "proofFile", "receiptFile", "paidAt", "proofAt", "closedAt")
SELECT id, 'record-a', amount, 'Synthetic invoice', status::"InvoiceStatus",
       CASE WHEN proof IS NOT NULL THEN '/api/files/2026/11/' || repeat(proof, 24) || '.png' END,
       CASE WHEN receipt = 'C' THEN '/api/files/2026/11/%43' || repeat('C', 23) || '.png'
            WHEN receipt IS NOT NULL THEN '/api/files/2026/11/' || repeat(receipt, 24) || '.png' END,
       CASE WHEN status = 'PAID' THEN timestamp '2024-01-15 14:30' END,
       CASE WHEN proof IS NOT NULL THEN timestamp '2024-01-14 14:30' END,
       CASE WHEN status = 'PAID' THEN timestamp '2024-01-16 14:30' END
FROM (VALUES
    ('invoice-new', 900, 'SENT', null, null),
    ('invoice-second', 725, 'SENT', null, null),
    ('invoice-legacy-good', 500, 'PAID', 'E', 'A'),
    ('invoice-legacy-unverified', 1250, 'PAID', 'B', 'C'),
    ('invoice-legacy-duplicate-one', 1050, 'PAID', null, 'F'),
    ('invoice-legacy-duplicate-two', 1150, 'PAID', null, 'F'),
    ('invoice-historical', 1100, 'PAID', null, 'G'),
    ('invoice-historical-conflict', 1200, 'PAID', null, 'L'),
    ('invoice-current-conflict', 1300, 'PAID', null, 'L')
) AS invoices(id, amount, status, proof, receipt);

INSERT INTO "Upload" (id, "ownerId", path, name, mime, size)
VALUES ('placement-edit', 'teacher-b', '2026/11/' || repeat('I', 24) || '.wav', 'synthetic.wav', 'audio/wav', 60),
       ('placement-snapshot', 'teacher-b', '2026/11/' || repeat('J', 24) || '.wav', 'synthetic.wav', 'audio/wav', 60);
INSERT INTO "PlacementEdit" ("itemId", data, audio, "updatedBy", "updatedAt")
VALUES ('synthetic-edit', '{}', '2026/11/' || repeat('I', 24) || '.wav', 'teacher-b', now());
INSERT INTO "PlacementAttempt" (id, "teacherId", mode, token, state, "updatedAt")
VALUES ('fixture-placement', 'teacher-a', 'self', 'fixture-placement-token',
    jsonb_build_object('items', jsonb_build_object('synthetic-listening', jsonb_build_object(
        'type', 'listening', 'audio', '/api/files/2026/11/' || repeat('J', 24) || '.wav'
    ))), now());

INSERT INTO "Course" (id, "teacherId", title, "updatedAt") VALUES ('fixture-course', 'teacher-a', 'Synthetic course', now());
INSERT INTO "Unit" (id, "courseId", title) VALUES ('fixture-unit', 'fixture-course', 'Synthetic unit');
INSERT INTO "LessonTemplate" (id, "unitId", title, sections, "shareOn", "shareToken", "updatedAt")
VALUES ('fixture-template', 'fixture-unit', 'Synthetic public lesson', '[{"id":"main","title":"Synthetic section"}]', true, 'synthetic-share', now());
INSERT INTO "Task" (id, "templateId", title, type, section, options)
VALUES ('fixture-homework', 'fixture-template', 'Synthetic homework picture', 'image', 'homework',
    jsonb_build_object('images', jsonb_build_array(jsonb_build_object('src', '/api/files/2026/11/' || repeat('D', 24) || '.png'))));
INSERT INTO "LessonInstance" (id, "templateId", "teacherId", "studentId", "startsAt")
VALUES ('fixture-class', 'fixture-template', 'teacher-a', 'record-a', now());
INSERT INTO "Homework" (id, "lessonInstanceId", "taskIds", "extraTaskIds")
VALUES ('fixture-homework-history', 'fixture-class', ARRAY['fixture-homework'], ARRAY['fixture-homework']);
