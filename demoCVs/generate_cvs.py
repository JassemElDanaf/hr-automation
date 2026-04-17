from fpdf import FPDF
import os

base = os.path.dirname(os.path.abspath(__file__))
os.makedirs(f"{base}/software-engineer", exist_ok=True)
os.makedirs(f"{base}/devops-engineer", exist_ok=True)

def make_cv(path, name, lines):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(190, 10, name, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    for line in lines:
        if line.startswith("##"):
            pdf.ln(3)
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(190, 6, line[2:].strip(), new_x="LMARGIN", new_y="NEXT")
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.ln(1)
            pdf.set_font("Helvetica", "", 10)
        elif line.startswith("- "):
            pdf.multi_cell(190, 5, "    " + line[2:])
        elif line == "":
            pdf.ln(2)
        else:
            pdf.multi_cell(190, 5, line)
    pdf.output(path)

# === SOFTWARE ENGINEER ===

make_cv(f"{base}/software-engineer/Jassem_Danaf.pdf", "Jassem Danaf", [
    "jassemdanaf6@gmail.com | +961 70 151 699 | linkedin.com/in/jassemdanaf",
    "",
    "## SUMMARY",
    "Full-stack software engineer with 3+ years of hands-on experience building web applications using React, Node.js, Python, and PostgreSQL. Passionate about clean architecture, automation, and AI-powered tooling.",
    "",
    "## EDUCATION",
    "American University of Beirut (AUB) - B.E. Computer Science",
    "Graduation: June 2026 | GPA: 3.6/4.0",
    "Coursework: Data Structures, Algorithms, Databases, Machine Learning, Software Engineering, OS, Networks",
    "",
    "## WORK EXPERIENCE",
    "Research Assistant - Maroun Semaan Faculty of Engineering, AUB | Jan 2026 - Present",
    "- Developed data pipelines in Python for processing 50K+ academic records",
    "- Built internal dashboards with React and Chart.js for faculty analytics",
    "- Automated report generation using LaTeX and Python scripting",
    "",
    "Software Engineering Intern - Murex S.A.L. | Jun 2025 - Aug 2025",
    "- Contributed to a high-frequency trading platform backend in Java and C++",
    "- Wrote unit and integration tests achieving 92% code coverage",
    "- Optimized database queries reducing response time by 35%",
    "",
    "Freelance Developer | Sep 2023 - May 2025",
    "- Built 8+ client websites using React, Next.js, and Tailwind CSS",
    "- Developed REST APIs with Node.js/Express and PostgreSQL",
    "- Deployed applications on AWS (EC2, S3, RDS) and Vercel",
    "",
    "## SKILLS",
    "Languages: JavaScript/TypeScript, Python, Java, C++, SQL, HTML/CSS",
    "Frameworks: React, Next.js, Node.js, Express, Django, Flask",
    "Databases: PostgreSQL, MongoDB, Redis",
    "Tools: Git, Docker, AWS, Linux, CI/CD, n8n, Vite",
    "AI/ML: TensorFlow, scikit-learn, Ollama, LangChain",
    "",
    "## PROJECTS",
    "HR Automation Platform - Capstone Project",
    "- Built end-to-end HR pipeline with React frontend, n8n workflows, PostgreSQL, and Ollama LLM",
    "- Implemented AI-powered CV evaluation scoring 10+ candidates per job opening",
    "",
    "Study Buddy - Hackathon Winner (AUB Hackathon 2024)",
    "- AI tutoring app using GPT-4 API with React Native frontend",
    "- Won 1st place among 40+ teams",
])

make_cv(f"{base}/software-engineer/Lara_Khoury.pdf", "Lara Khoury", [
    "lara.khoury.fake@example.com",
    "",
    "## SUMMARY",
    "Backend engineer with 4 years of experience in Python, Django, and microservices architecture. Experience with AWS, Docker, and CI/CD pipelines.",
    "",
    "## EDUCATION",
    "Lebanese American University - B.S. Computer Science, 2023 | GPA: 3.4/4.0",
    "",
    "## EXPERIENCE",
    "Backend Developer - Cedar Technologies | 2023-Present",
    "- Designed RESTful APIs serving 2M+ daily requests using Django and PostgreSQL",
    "- Migrated monolith to microservices, reducing deploy time by 60%",
    "- Set up monitoring with Grafana and Prometheus",
    "",
    "Junior Developer - Webline SARL | 2021-2023",
    "- Built internal tools with Flask and SQLAlchemy",
    "- Wrote automated tests with pytest (85% coverage)",
    "",
    "## SKILLS",
    "Python, Django, Flask, PostgreSQL, Docker, AWS, Redis, Git, Linux, REST APIs",
])

make_cv(f"{base}/software-engineer/Ahmad_Mansour.pdf", "Ahmad Mansour", [
    "ahmad.mansour.fake@example.com",
    "",
    "## SUMMARY",
    "Frontend developer specializing in React and TypeScript. 2 years building SPAs and component libraries for fintech startups.",
    "",
    "## EDUCATION",
    "University of Balamand - B.S. Software Engineering, 2024",
    "",
    "## EXPERIENCE",
    "Frontend Developer - PayTech Lebanon | 2024-Present",
    "- Built payment dashboard with React, TypeScript, and Tailwind CSS",
    "- Implemented real-time data visualization with D3.js",
    "- Reduced bundle size by 40% through code splitting and lazy loading",
    "",
    "Intern - Digital Plus | Summer 2023",
    "- Built landing pages with Next.js and Vercel",
    "- Integrated Stripe payment API",
    "",
    "## SKILLS",
    "React, TypeScript, Next.js, Tailwind CSS, D3.js, Git, Figma, REST APIs, GraphQL",
])

make_cv(f"{base}/software-engineer/Maya_Haddad.pdf", "Maya Haddad", [
    "maya.haddad.fake@example.com",
    "",
    "## SUMMARY",
    "New CS graduate looking for first role. Strong academic foundation but limited industry experience.",
    "",
    "## EDUCATION",
    "Holy Spirit University of Kaslik - B.S. Computer Science, 2026 | GPA: 2.9/4.0",
    "",
    "## EXPERIENCE",
    "No professional experience.",
    "",
    "## PROJECTS",
    "- To-do app in React (class project)",
    "- Calculator in Java (class project)",
    "- Personal blog in WordPress",
    "",
    "## SKILLS",
    "Java, basic Python, HTML/CSS, some React",
])

# === DEVOPS ENGINEER ===

make_cv(f"{base}/devops-engineer/Karim_Saleh.pdf", "Karim Saleh", [
    "karim.saleh.fake@example.com",
    "",
    "## SUMMARY",
    "DevOps engineer with 3 years experience in CI/CD, Kubernetes, and cloud infrastructure on AWS and GCP.",
    "",
    "## EDUCATION",
    "American University of Beirut - B.E. Computer & Communications Engineering, 2023",
    "",
    "## EXPERIENCE",
    "DevOps Engineer - CloudScale MENA | 2023-Present",
    "- Managed 50+ microservices on Kubernetes (EKS) with Helm charts",
    "- Built CI/CD pipelines with GitHub Actions and ArgoCD",
    "- Reduced infrastructure costs by 30% through right-sizing and spot instances",
    "- Implemented monitoring stack: Prometheus, Grafana, PagerDuty",
    "",
    "SysAdmin Intern - Ogero Telecom | Summer 2022",
    "- Automated server provisioning with Ansible",
    "- Managed Linux servers (Ubuntu, CentOS)",
    "",
    "## SKILLS",
    "Kubernetes, Docker, Terraform, AWS, GCP, GitHub Actions, Jenkins, Ansible, Prometheus, Grafana, Linux, Python, Bash",
])

make_cv(f"{base}/devops-engineer/Rima_Fares.pdf", "Rima Fares", [
    "rima.fares.fake@example.com",
    "",
    "## SUMMARY",
    "Junior IT professional transitioning into DevOps. Some Linux and scripting experience. Currently studying for AWS Cloud Practitioner certification.",
    "",
    "## EDUCATION",
    "Lebanese University - B.S. Information Technology, 2025",
    "",
    "## EXPERIENCE",
    "IT Support - MedTech Hospital | 2025-Present",
    "- Managed Windows and Linux workstations for 200+ users",
    "- Basic scripting with PowerShell and Bash",
    "",
    "## SKILLS",
    "Linux basics, Windows Server, PowerShell, Bash, some Docker, networking fundamentals",
])

make_cv(f"{base}/devops-engineer/Tarek_Bazzi.pdf", "Tarek Bazzi", [
    "tarek.bazzi.fake@example.com",
    "",
    "## SUMMARY",
    "Site reliability engineer with 5 years experience. Expert in infrastructure as code, observability, and incident management. Previously at scale-up serving 10M+ users.",
    "",
    "## EDUCATION",
    "Saint Joseph University - M.S. Computer Science, 2020",
    "Lebanese American University - B.S. Computer Science, 2018",
    "",
    "## EXPERIENCE",
    "Senior SRE - Anghami | 2022-Present",
    "- Led migration from on-prem to AWS, achieving 99.99% uptime",
    "- Built Terraform modules managing 200+ AWS resources",
    "- Designed disaster recovery plan with cross-region replication",
    "- On-call rotation lead, reduced MTTR from 45min to 12min",
    "",
    "DevOps Engineer - Roadster Group | 2020-2022",
    "- Containerized 30+ services with Docker and orchestrated on ECS",
    "- Built Jenkins pipelines with parallel testing stages",
    "- Implemented secrets management with HashiCorp Vault",
    "",
    "## SKILLS",
    "AWS, Terraform, Kubernetes, Docker, Jenkins, GitHub Actions, Datadog, PagerDuty, Python, Go, PostgreSQL, Redis, Kafka, Linux",
])

print("Done! 7 PDFs generated.")
