#!/usr/bin/env python3
"""Generate realistic CV PDFs for E2E testing (pdfjs-parseable text).

Three candidates with deliberately different fit for a backend-engineer role so
the AI evaluation should produce a spread of scores (strong > average > weak).
All names start with "QA " and emails use @example.com so the global teardown
removes them. Run: python tests/fixtures/make_cvs.py
"""
from fpdf import FPDF
import os

HERE = os.path.dirname(os.path.abspath(__file__))

CVS = {
    "QA Strong Candidate.pdf": [
        "QA Strong Candidate",
        "Email: qa.strong@example.com  |  Phone: +961 70 000 001",
        "",
        "SUMMARY",
        "Senior Backend Engineer with 6 years building production services in Python.",
        "",
        "SKILLS",
        "Python, FastAPI, Django, PostgreSQL, Docker, Kubernetes, REST API design,",
        "Redis, CI/CD (GitHub Actions), AWS, microservices, SQL optimization.",
        "",
        "EXPERIENCE",
        "Lead Backend Engineer, TechCorp (2021-2026)",
        "- Designed and scaled REST APIs in Python/FastAPI serving 2M requests/day.",
        "- Owned PostgreSQL schema design, query tuning, and Docker-based deployments.",
        "Backend Engineer, DataSoft (2019-2021)",
        "- Built microservices, wrote integration tests, managed CI/CD pipelines.",
        "",
        "EDUCATION",
        "BS in Computer Science, American University of Beirut, 2019.",
    ],
    "QA Average Candidate.pdf": [
        "QA Average Candidate",
        "Email: qa.average@example.com  |  Phone: +961 70 000 002",
        "",
        "SUMMARY",
        "Junior developer with about 1 year of experience, eager to grow.",
        "",
        "SKILLS",
        "Python basics, some SQL, Flask, HTML/CSS, Git. Familiar with small web apps.",
        "",
        "EXPERIENCE",
        "Junior Developer, StartupX (2024-2025)",
        "- Built small internal tools in Flask, fixed bugs, wrote simple queries.",
        "",
        "EDUCATION",
        "Self-taught via online courses; Bachelor in Business Administration, 2023.",
    ],
    "QA Weak Candidate.pdf": [
        "QA Weak Candidate",
        "Email: qa.weak@example.com  |  Phone: +961 70 000 003",
        "",
        "SUMMARY",
        "Creative Graphic Designer with 8 years in branding and print design.",
        "",
        "SKILLS",
        "Adobe Photoshop, Illustrator, InDesign, branding, typography, print layout.",
        "No programming or backend experience.",
        "",
        "EXPERIENCE",
        "Senior Graphic Designer, AdAgency (2017-2025)",
        "- Led visual identity projects, brochures, and marketing campaigns.",
        "",
        "EDUCATION",
        "Diploma in Fine Arts, 2016.",
    ],
}


def build(path, lines):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for ln in lines:
        if ln and ln.isupper() and len(ln) < 20:
            pdf.set_font("Helvetica", style="B", size=12)
            pdf.cell(0, 7, ln, ln=1)
            pdf.set_font("Helvetica", size=11)
        elif ln == lines[0]:  # name as title
            pdf.set_font("Helvetica", style="B", size=16)
            pdf.cell(0, 9, ln, ln=1)
            pdf.set_font("Helvetica", size=11)
        else:
            pdf.cell(0, 6, ln, ln=1)
    pdf.output(path)


if __name__ == "__main__":
    for name, lines in CVS.items():
        out = os.path.join(HERE, name)
        build(out, lines)
        print("wrote", out, os.path.getsize(out), "bytes")
