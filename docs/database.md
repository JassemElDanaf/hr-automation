# Database

PostgreSQL 16 running inside the `hr-postgres` Docker container.

---

## Connection Parameters

| Setting | Value |
|---------|-------|
| Host | `localhost` |
| Port | `5432` |
| Database | `hr_automation` |
| User | `hr_admin` |
| Password | `hr_pass` |
| SSL | disabled (local dev) |

> These are hardcoded for local dev. They also live in `.env.example` and `start.sh`.

---

## Connect

### From the host via `psql`
```bash
psql -h localhost -p 5432 -U hr_admin -d hr_automation
# password: hr_pass
```

### From inside the container
```bash
docker exec -it hr-postgres psql -U hr_admin -d hr_automation
```

### From n8n
Use the credential named **`HR PostgreSQL`** (configured once in n8n → Settings → Credentials).

---

## Schema Files

Run in this order. All files are idempotent (`IF NOT EXISTS`, `IF EXISTS`).

| File | What it creates / changes |
|------|--------------------------|
| `db/schema.sql` | `job_openings` table + indexes + `updated_at` trigger |
| `db/migrations/001-phase2-cv-evaluation.sql` | `candidates`, `evaluations` |
| `db/migrations/002-criteria-sets.sql` | `criteria_sets` |
| `db/migrations/003-phase3-shortlist.sql` | `shortlist` |
| `db/migrations/004-phase4-email-log.sql` | `email_log` |
| `db/migrations/005-phase4-smtp.sql` | `error_message` column + expanded `status` CHECK on `email_log` |
| `db/migrations/006-criteria-items.sql` | `criteria_items` JSONB column on `criteria_sets` |
| `db/migrations/007-cv-file-data.sql` | `cv_file_name`, `cv_file_data` (TEXT base64), `cv_file_mime` on `candidates` |
| `db/migrations/008-recommendation-email-type.sql` | Relaxes `email_log` CHECK to allow `'recommendation'` |
| `db/migrations/009-email-direction.sql` | `direction`, `message_id`, `in_reply_to` columns + indexes on `email_log` |
| `db/migrations/010-interview-questions.sql` | `interview_questions` table |
| `db/migrations/011-interview-sessions.sql` | `interview_sessions` table |
| `db/migrations/012-live-interview.sql` | Live interview related tables/columns |
| `db/migrations/013-question-bank.sql` | `question_bank` table |

### Apply everything
```bash
# schema
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/schema.sql

# migrations
for f in db/migrations/*.sql; do
  echo "Applying $f"
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

### Seed sample data
```bash
bash scripts/seed-db.sh
# or manually:
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/seed.sql
```

---

## Tables

### `job_openings`
Core table. One row per job posting.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `job_title` | VARCHAR(255) | required |
| `department` | VARCHAR(255) | required |
| `employment_type` | VARCHAR(50) | Full-time / Part-time / Contract / Internship / Temporary |
| `seniority_level` | VARCHAR(50) | Junior / Mid-level / Senior / Lead / Manager / Director / VP / C-level |
| `location_type` | VARCHAR(50) | On-site / Remote / Hybrid |
| `reporting_to` | VARCHAR(255) | |
| `description_source_type` | VARCHAR(20) | ai_generated / manual / file_upload |
| `job_description` | TEXT | required |
| `uploaded_file_name` | VARCHAR(255) | |
| `status` | VARCHAR(20) | CHECK: `draft` / `open` / `closed` / `on_hold`; default `open` |
| `is_active` | BOOLEAN | default TRUE |
| `created_at` / `updated_at` | TIMESTAMP | trigger auto-updates `updated_at` |

### `candidates`
CVs submitted for a job.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `job_opening_id` | FK → `job_openings.id` ON DELETE CASCADE | |
| `candidate_name` | VARCHAR(255) | required |
| `email` | VARCHAR(255) | used for rejection/interview emails |
| `cv_text` | TEXT | extracted on frontend via pdf.js |
| `cv_file_name` | VARCHAR(255) | original filename |
| `cv_file_data` | TEXT | base64-encoded PDF; retrieve via `/cv-file?candidate_id=N` |
| `cv_file_mime` | VARCHAR(100) | MIME type of the stored file |
| `submitted_at` | TIMESTAMP | |

### `evaluations`
AI-produced scores. Unique on `(candidate_id, job_opening_id)`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` ON DELETE CASCADE | |
| `job_opening_id` | FK → `job_openings.id` ON DELETE CASCADE | |
| `overall_score` | DECIMAL(3,1) | 0–10 |
| `skills_score` / `experience_score` / `education_score` | DECIMAL(3,1) | 0–10 each |
| `reasoning` / `strengths` / `weaknesses` | TEXT | Ollama narrative output |
| `evaluated_at` | TIMESTAMP | |

### `criteria_sets`
Named, saved evaluation criteria for reuse.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `name` | VARCHAR(255) | required |
| `job_opening_id` | FK → `job_openings.id` ON DELETE SET NULL | optional link |
| `criteria_text` | TEXT | free-text criteria blob |
| `skills_weight` / `experience_weight` / `education_weight` | INT | each 0–100; together should total 100 |
| `criteria_items` | JSONB | array of `{text, required}`; default `[]` |
| `created_at` | TIMESTAMP | |

### `shortlist`
Per-candidate status for a job. Unique on `(candidate_id, job_opening_id)`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` ON DELETE CASCADE | |
| `job_opening_id` | FK → `job_openings.id` ON DELETE CASCADE | |
| `status` | VARCHAR(20) | CHECK: `shortlisted` / `interviewed` / `hired` / `rejected` |
| `notes` | TEXT | |
| `shortlisted_at` / `updated_at` | TIMESTAMP | |

### `email_log`
Every email attempted (sent, failed, or logged without sending) plus inbound replies.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` ON DELETE CASCADE | |
| `job_opening_id` | FK → `job_openings.id` ON DELETE CASCADE | |
| `email_type` | VARCHAR(30) | CHECK: `rejection` / `interview_invite` / `offer` / `custom` / `recommendation` |
| `recipient_email` | VARCHAR(255) | outbound: destination; inbound: sender (the other party) |
| `subject` / `body` | TEXT | |
| `status` | VARCHAR(20) | CHECK: `sent` / `failed` / `pending` / `logged` |
| `error_message` | TEXT | set only when `status='failed'` |
| `sent_at` | TIMESTAMP | attempt timestamp |
| `direction` | VARCHAR(10) | CHECK: `outbound` / `inbound`; default `outbound` |
| `message_id` | TEXT | RFC-822 Message-ID generated by SMTP sidecar |
| `in_reply_to` | TEXT | In-Reply-To header from inbound reply |

Indexes on `message_id` and `in_reply_to` for O(log n) reply threading lookups.

### `interview_questions`
Per-candidate interview question sets generated by Ollama.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` | |
| `job_opening_id` | FK → `job_openings.id` | |
| `question` | TEXT | |
| `category` | VARCHAR(50) | `hr` / `technical` / `salary` |
| `hints` | TEXT | |
| `created_at` | TIMESTAMP | |

### `interview_sessions`
Live interview session records.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` (nullable) | |
| `job_opening_id` | FK → `job_openings.id` (nullable) | |
| `token` | TEXT | session access token |
| `started_at` / `ended_at` | TIMESTAMP | |
| `transcript` | JSONB | full session transcript |
| `status` | VARCHAR(20) | |

### `question_bank`
Reusable question library for live interviews.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `question` | TEXT | |
| `category` | VARCHAR(100) | |
| `job_type` | VARCHAR(255) | |
| `model_answer` | TEXT | |
| `times_used` | INT | default 0 |
| `created_at` | TIMESTAMP | |

---

## Useful Inspection Queries

```sql
-- All job openings with their candidate counts
SELECT j.id, j.job_title, j.status, j.is_active,
       COUNT(DISTINCT c.id) AS candidates,
       COUNT(DISTINCT e.id) AS evaluated
  FROM job_openings j
  LEFT JOIN candidates  c ON c.job_opening_id = j.id
  LEFT JOIN evaluations e ON e.job_opening_id = j.id
 GROUP BY j.id
 ORDER BY j.id;

-- Top 10 candidates across all jobs
SELECT c.candidate_name, c.email, j.job_title, e.overall_score
  FROM evaluations e
  JOIN candidates  c ON c.id = e.candidate_id
  JOIN job_openings j ON j.id = e.job_opening_id
 ORDER BY e.overall_score DESC
 LIMIT 10;

-- Shortlist status breakdown per job
SELECT j.job_title, s.status, COUNT(*) AS n
  FROM shortlist s
  JOIN job_openings j ON j.id = s.job_opening_id
 GROUP BY j.job_title, s.status
 ORDER BY j.job_title, s.status;

-- Email log summary (outbound only)
SELECT status, COUNT(*) AS n,
       MAX(sent_at) AS last_attempt,
       MAX(error_message) AS last_error
  FROM email_log
 WHERE direction = 'outbound'
 GROUP BY status;

-- Inbound replies with their parent outbound rows
SELECT i.id AS inbound_id, i.recipient_email AS sender,
       i.subject AS reply_subject, i.sent_at AS received_at,
       o.recipient_email AS original_to, o.email_type AS original_type
  FROM email_log i
  JOIN email_log o ON o.message_id = i.in_reply_to
 WHERE i.direction = 'inbound'
 ORDER BY i.sent_at DESC;

-- Jobs with evaluations but no saved criteria set (ad-hoc scoring)
SELECT j.id, j.job_title
  FROM job_openings j
  JOIN evaluations e ON e.job_opening_id = j.id
 WHERE NOT EXISTS (SELECT 1 FROM criteria_sets cs WHERE cs.job_opening_id = j.id)
 GROUP BY j.id, j.job_title;

-- Question bank contents by category
SELECT category, COUNT(*) AS n, MAX(times_used) AS max_uses
  FROM question_bank
 GROUP BY category
 ORDER BY category;

-- Interview sessions with transcript length
SELECT s.id, s.status, s.started_at, s.ended_at,
       c.candidate_name, j.job_title,
       jsonb_array_length(s.transcript) AS transcript_entries
  FROM interview_sessions s
  LEFT JOIN candidates  c ON c.id = s.candidate_id
  LEFT JOIN job_openings j ON j.id = s.job_opening_id
 ORDER BY s.started_at DESC;

-- Candidates with CVs stored (file upload available)
SELECT c.id, c.candidate_name, c.cv_file_name, c.cv_file_mime,
       j.job_title
  FROM candidates c
  JOIN job_openings j ON j.id = c.job_opening_id
 WHERE c.cv_file_data IS NOT NULL
 ORDER BY c.submitted_at DESC;
```

---

## Backup / Restore

### Backup
```bash
docker exec hr-postgres pg_dump -U hr_admin hr_automation > backup_$(date +%Y%m%d).sql
```

### Restore
```bash
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < backup_20260101.sql
```

### Reset everything
```bash
docker exec -it hr-postgres psql -U hr_admin -d hr_automation \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# then re-apply schema + migrations
```

---

## Adding a New Migration

1. Create `db/migrations/NNN-description.sql` with the next number
2. Use `IF NOT EXISTS` / `IF EXISTS` guards so it's safe to re-run
3. Apply: `docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/migrations/NNN-description.sql`
4. Update the schema files table and the tables section in this file
5. Update `CLAUDE.md` §3 to list the new migration
