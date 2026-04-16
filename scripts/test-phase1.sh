#!/bin/bash
# Test Phase 1 API endpoints
# Requires: n8n running with workflows active

set -e

BASE_URL="http://localhost:5678/webhook"
PASS=0
FAIL=0

green() { echo -e "\033[32m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }

test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local data="$4"
    local expect_code="$5"

    echo -n "Testing: $name... "

    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" 2>/dev/null)
    fi

    code=$(echo "$response" | tail -1)
    body=$(echo "$response" | head -n -1)

    if [ "$code" = "$expect_code" ]; then
        green "PASS (HTTP $code)"
        PASS=$((PASS + 1))
    else
        red "FAIL (expected $expect_code, got $code)"
        echo "  Response: $body"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Phase 1 API Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Create job (manual)
test_endpoint "Create job (manual)" POST "$BASE_URL/job-openings" '{
  "job_title": "Test Engineer",
  "department": "QA",
  "employment_type": "Full-time",
  "seniority_level": "Mid-level",
  "location_type": "Remote",
  "description_source": "manual",
  "job_description": "This is a test job description for a QA Test Engineer position. The candidate will be responsible for ensuring product quality through automated and manual testing."
}' "201"

# Test 2: Create job (AI generate)
test_endpoint "Create job (AI generate)" POST "$BASE_URL/job-openings" '{
  "job_title": "Data Scientist",
  "department": "Analytics",
  "employment_type": "Full-time",
  "seniority_level": "Senior",
  "location_type": "Hybrid",
  "reporting_to": "Head of Analytics",
  "description_source": "ai_generate"
}' "201"

# Test 3: Create job — missing fields (should fail)
test_endpoint "Create job - missing fields" POST "$BASE_URL/job-openings" '{
  "job_title": "Incomplete Job"
}' "400"

# Test 4: Create job — invalid employment type (should fail)
test_endpoint "Create job - invalid type" POST "$BASE_URL/job-openings" '{
  "job_title": "Bad Job",
  "department": "Test",
  "employment_type": "InvalidType",
  "seniority_level": "Junior",
  "location_type": "Remote",
  "description_source": "manual",
  "job_description": "This should fail because employment type is invalid."
}' "400"

# Test 5: List all jobs
test_endpoint "List all jobs" GET "$BASE_URL/job-openings" "" "200"

# Test 6: Get single job (ID 1)
test_endpoint "Get job by ID" GET "$BASE_URL/job-opening?id=1" "" "200"

# Test 7: Get non-existent job
test_endpoint "Get non-existent job" GET "$BASE_URL/job-opening?id=99999" "" "404"

# Test 8: Toggle job active status
test_endpoint "Toggle job status" POST "$BASE_URL/job-opening-toggle?id=1" "" "200"

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS + FAIL))"

if [ "$FAIL" -gt 0 ]; then
    red "Some tests failed!"
    exit 1
else
    green "All tests passed!"
fi
