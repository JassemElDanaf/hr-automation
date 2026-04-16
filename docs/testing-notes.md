# Testing Notes

## Test Script

Run the automated test suite:
```bash
bash scripts/test-phase1.sh
```

## Manual Testing

### Test Cases

#### 1. Create Job — Manual Description
- **Endpoint**: POST /webhook/job-openings
- **Input**: All required fields + `description_source: "manual"` + `job_description`
- **Expected**: 201, job saved to DB with `description_source_type: "manual"`

#### 2. Create Job — AI Generate
- **Endpoint**: POST /webhook/job-openings
- **Input**: All required fields + `description_source: "ai_generate"`
- **Expected**: 201, job saved with AI-generated description
- **Fallback**: If Ollama unavailable, template-based description is used

#### 3. Create Job — File Upload
- **Endpoint**: POST /webhook/job-openings
- **Input**: All required fields + `description_source: "file_upload"` + `file_name` + `file_content`
- **Expected**: 201, job saved with extracted text as description

#### 4. Validation — Missing Fields
- **Input**: Partial data (missing department, etc.)
- **Expected**: 400 with clear error message listing missing fields

#### 5. Validation — Invalid Enum Values
- **Input**: `employment_type: "InvalidValue"`
- **Expected**: 400 with allowed values in error message

#### 6. Validation — Short Description
- **Input**: `description_source: "manual"` with `job_description: "too short"`
- **Expected**: 400, description must be at least 20 characters

#### 7. List Jobs
- **Endpoint**: GET /webhook/job-openings
- **Expected**: 200, array of jobs sorted by newest first
- **Filters**: `?is_active=true`, `?status=open`, `?department=Engineering`

#### 8. Get Single Job
- **Endpoint**: GET /webhook/job-opening?id=1
- **Expected**: 200 with full job data including description

#### 9. Get Non-Existent Job
- **Endpoint**: GET /webhook/job-opening?id=99999
- **Expected**: 404

#### 10. Toggle Active Status
- **Endpoint**: POST /webhook/job-opening-toggle?id=1
- **Expected**: 200, `is_active` flipped from current value

## Verify in Database

```bash
docker exec hr-postgres psql -U hr_admin -d hr_automation -c "SELECT id, job_title, status, is_active FROM job_openings ORDER BY created_at DESC;"
```
