-- Seed data for testing Phase 1

INSERT INTO job_openings (
    job_title, department, employment_type, seniority_level, location_type,
    reporting_to, description_source_type, job_description, status, is_active
) VALUES
(
    'Software Engineer',
    'Engineering',
    'Full-time',
    'Mid-level',
    'Hybrid',
    'Engineering Manager',
    'manual',
    'We are looking for a Software Engineer to join our team. You will design, develop, and maintain web applications. Requirements: 3+ years experience with JavaScript/TypeScript, familiarity with React and Node.js, experience with SQL databases, strong problem-solving skills.',
    'open',
    TRUE
),
(
    'Product Manager',
    'Product',
    'Full-time',
    'Senior',
    'On-site',
    'VP of Product',
    'manual',
    'We are seeking a Senior Product Manager to lead product strategy and execution. You will work with engineering, design, and business teams to deliver impactful products. Requirements: 5+ years in product management, strong analytical skills, experience with agile methodologies.',
    'open',
    TRUE
),
(
    'UX Designer',
    'Design',
    'Contract',
    'Junior',
    'Remote',
    'Design Lead',
    'manual',
    'Looking for a UX Designer to create intuitive user experiences. You will conduct user research, create wireframes, and design prototypes. Requirements: portfolio demonstrating UX process, proficiency in Figma, understanding of accessibility standards.',
    'draft',
    FALSE
);
