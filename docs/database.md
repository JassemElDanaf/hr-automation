# Database

> **Project status:** Proof of concept, pre-finalization. Schema is stable for the current feature set; new migrations will be added as finalization work lands. See `report/report.pdf` for the stakeholder progress report.

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

| File | What it creates |
|------|-----------------|
| `db/schema.sql` | `job_openings` table + indexes + updated_at trigger |
| `db/migrations/001-phase2-cv-evaluation.sql` | `candidates`, `evaluations` |
| `db/migrations/002-criteria-sets.sql` | `criteria_sets` |
| `db/migrations/003-phase3-shortlist.sql` | `shortlist` |
| `db/migrations/004-phase4-email-log.sql` | `email_log` |
| `db/migrations/005-phase4-smtp.sql` | `error_message` column + expanded status check on `email_log` |

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
| `employment_type` | VARCHAR(50) | enum: Full-time / Part-time / Contract / Internship / Temporary |
| `seniority_level` | VARCHAR(50) | enum: Junior / Mid-level / Senior / Lead / Manager / Director / VP / C-level |
| `location_type` | VARCHAR(50) | enum: On-site / Remote / Hybrid |
| `reporting_to` | VARCHAR(255) | |
| `description_source_type` | VARCHAR(20) | enum: ai_generated / manual / file_upload |
| `job_description` | TEXT | required |
| `uploaded_file_name` | VARCHAR(255) | |
| `status` | VARCHAR(20) | default `draft`; enum: draft / open / closed / on_hold |
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
| `cv_file_name` | VARCHAR(255) | |
| `submitted_at` | TIMESTAMP | |

### `evaluations`
AI-produced scores. Unique on `(candidate_id, job_opening_id)`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` | FK → `candidates.id` ON DELETE CASCADE | |
| `job_opening_id` | FK → `job_openings.id` ON DELETE CASCADE | |
| `overall_score` | DECIMAL(3,1) | 0–10 |
| `skills_score` / `experience_score` / `education_score` | DECIMAL(3,1) | 0–10 |
| `reasoning`, `strengths`, `weaknesses` | TEXT | Ollama narrative output |
| `evaluated_at` | TIMESTAMP | |

### `criteria_sets`
Named, saved evaluation criteria for reuse.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `name` | VARCHAR(255) | required |
| `job_opening_id` | FK → `job_openings.id` ON DELETE SET NULL | optional link |
| `criteria_text` | TEXT | required |
| `skills_weight` / `experience_weight` / `education_weight` | INT | each 0–100, together should total 100 |
| `created_at` | TIMESTAMP | |

### `shortlist`
Per-candidate status for a job. Unique on `(candidate_id, job_opening_id)`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` / `job_opening_id` | FKs ON DELETE CASCADE | |
| `status` | VARCHAR(20) | enum: shortlisted / interviewed / hired / rejected |
| `notes` | TEXT | |
| `shortlisted_at` / `updated_at` | TIMESTAMP | |

### `email_log`
Every email attempted (sent, failed, or logged without sending).

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `candidate_id` / `job_opening_id` | FKs ON DELETE CASCADE | |
| `email_type` | VARCHAR(30) | enum: rejection / interview_invite / offer / custom |
| `recipient_email`, `subject`, `body` | — | |
| `status` | VARCHAR(20) | enum: sent / failed / pending / logged |
| `error_message` | TEXT | set only when `status='failed'` |
| `sent_at` | TIMESTAMP | attempt timestamp |

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

-- Email log summary
SELECT status, COUNT(*) AS n,
       MAX(sent_at) AS last_attempt,
       MAX(error_message) AS last_error
  FROM email_log
 GROUP BY status;

-- Jobs with evaluations but no saved criteria set (the "ad-hoc" state)
SELECT j.id, j.job_title
  FROM job_openings j
  JOIN evaluations e ON e.job_opening_id = j.id
 WHERE NOT EXISTS (SELECT 1 FROM criteria_sets cs WHERE cs.job_opening_id = j.id)
 GROUP BY j.id, j.job_title;
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
4. Update `claude.md` fix log if the change is significant
5. Update the table docs in this file
