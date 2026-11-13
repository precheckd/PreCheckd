// The roles a posting can use: the 147 CoderByte role-test roles (source: the roles sheet). A recruiter types a
// title, picks the matching role, and its skills are filled in. Every role has Junior, Mid-level and Senior role
// tests, built on demand (see services/roleTests.js), so an unbuilt role simply puts applicants in the queue.
//
// id:     stable key (never change once used on a posting). Registered role tests carry the same id as roleKey.
// title:  what candidates see
// skills: skill keys the role covers. SKILL KEYS ARE CODERBYTE'S SKILL NAMES, lowercased with dashes
//         ('Active Directory' -> 'active-directory'). A skill with no test built yet is shown as "not testable yet".
// To add a role, add a line (and a SOC rule below if pay benchmarks should cover it).

const ROLES = [
  { id: "software-engineer-coding", title: "Software Engineer (Coding)", skills: ["algorithms", "debugging", "git"] },
  { id: "react-developer-front-end", title: "React Developer (Front-end)", skills: ["react", "node-js", "git"] },
  { id: "angular-developer-front-end", title: "Angular Developer (Front-end)", skills: ["angular", "git"] },
  { id: "vuejs-developer-front-end", title: "Vuejs Developer (Front-end)", skills: ["vue-js", "git"] },
  { id: "front-end-developer-html-css", title: "Front-end Developer (HTML/CSS)", skills: ["html", "css", "bootstrap"] },
  { id: "jquery-developer-javascript", title: "jQuery Developer (JavaScript)", skills: ["jquery"] },
  { id: "graphql-developer-api", title: "GraphQL Developer (API)", skills: ["graphql"] },
  { id: "data-science-coding", title: "Data Science (Coding)", skills: ["python", "numpy", "sql"] },
  { id: "data-science-pandas", title: "Data Science (Pandas)", skills: ["python", "numpy", "pandas"] },
  { id: "pandas-scikit-learn", title: "Pandas/scikit-learn", skills: ["python", "numpy", "pandas", "scikit-learn"] },
  { id: "ab-initio", title: "Ab Initio", skills: ["ab-initio"] },
  { id: "machine-learning-python", title: "Machine Learning (Python/TensorFlow)", skills: ["python", "tensorflow"] },
  { id: "prompt-engineering", title: "Prompt Engineering", skills: ["openai"] },
  { id: "ai-engineer", title: "AI Engineer", skills: ["llm", "rag", "langchain"] },
  { id: "devops-terraform", title: "DevOps (Terraform)", skills: ["terraform", "bash"] },
  { id: "machine-learning-python-16", title: "Machine Learning (Python/PyTorch)", skills: ["python", "pytorch"] },
  { id: "javascript-developer", title: "JavaScript Developer", skills: ["hash-table", "node-js", "rest", "javascript", "next-js"] },
  { id: "next-js-developer", title: "Next.js Developer", skills: ["node-js", "next-js"] },
  { id: "node-js-developer", title: "Node.js Developer", skills: ["node-js", "rest", "api", "javascript"] },
  { id: "node-js-api-developer", title: "Node.js API Developer", skills: ["node-js", "rest", "api", "javascript"] },
  { id: "back-end-developer", title: "Back-end Developer", skills: ["hash-table", "sql", "api", "algorithms", "git", "linux", "system-design"] },
  { id: "full-stack-developer", title: "Full-stack Developer", skills: ["mongodb", "api", "react", "git", "system-design"] },
  { id: "data-engineer-python", title: "Data Engineer (Python/Kafka/SQL)", skills: ["python", "kafka", "sql"] },
  { id: "data-engineer-python-24", title: "Data Engineer (Python/PySpark/SQL)", skills: ["python", "pyspark", "sql"] },
  { id: "data-engineer-python-25", title: "Data Engineer (Python/ETL/SQL)", skills: ["python", "etl", "sql"] },
  { id: "data-warehouse", title: "Data warehouse", skills: ["etl", "data-warehouse"] },
  { id: "financial-analyst", title: "Financial Analyst", skills: ["sql", "spreadsheet", "excel", "tableau"] },
  { id: "accounting", title: "Accounting", skills: ["spreadsheet", "excel", "finance"] },
  { id: "devops-aws", title: "DevOps (AWS)", skills: ["aws", "python", "cloud"] },
  { id: "devops-jenkins", title: "DevOps (Jenkins)", skills: ["jenkins"] },
  { id: "bigquery-developer", title: "BigQuery Developer", skills: ["sql", "bigquery", "cloud"] },
  { id: "ppc-analyst", title: "PPC Analyst", skills: ["marketing", "google-ads"] },
  { id: "aws-developer", title: "AWS Developer", skills: ["aws", "python", "cloud"] },
  { id: "devops-docker", title: "DevOps (Docker/GCP)", skills: ["docker", "gcp"] },
  { id: "devops-kubernetes", title: "DevOps (Kubernetes)", skills: ["kubernetes", "python", "cloud"] },
  { id: "devops-docker-36", title: "DevOps (Docker/Python/Cloud)", skills: ["docker", "python", "cloud"] },
  { id: "devops-ansible", title: "DevOps (Ansible)", skills: ["ansible", "bash", "cloud"] },
  { id: "apache-solr", title: "Apache Solr", skills: ["apache"] },
  { id: "pyspark-developer", title: "PySpark Developer", skills: ["pyspark", "python", "apache"] },
  { id: "wordpress-developer", title: "WordPress Developer", skills: ["wordpress", "php"] },
  { id: "drupal-developer", title: "Drupal Developer", skills: ["php", "drupal"] },
  { id: "django-developer", title: "Django Developer", skills: ["django", "python"] },
  { id: "go-developer", title: "Go Developer", skills: ["go", "algorithms", "linux"] },
  { id: "laravel-developer", title: "Laravel Developer", skills: ["php", "laravel"] },
  { id: "php-developer", title: "PHP Developer", skills: ["php", "wordpress"] },
  { id: "android-developer", title: "Android Developer", skills: ["android", "kotlin"] },
  { id: "appium-testing", title: "Appium Testing", skills: ["appium"] },
  { id: "sdet", title: "SDET", skills: ["debugging", "appium", "selenium"] },
  { id: "scala-developer", title: "Scala Developer", skills: ["scala"] },
  { id: "swift-developer", title: "Swift Developer", skills: ["swift"] },
  { id: "ios-developer", title: "iOS Developer", skills: ["ios", "swift"] },
  { id: "flutter-developer", title: "Flutter Developer", skills: ["dart", "flutter"] },
  { id: "databricks-developer", title: "Databricks Developer", skills: ["python", "databricks"] },
  { id: "power-bi-developer", title: "Power BI Developer", skills: ["power-bi"] },
  { id: "cosmos-db-developer", title: "Cosmos DB Developer", skills: ["cosmos-db", "azure"] },
  { id: "tableau-developer", title: "Tableau Developer", skills: ["sql", "tableau"] },
  { id: "servicenow-developer", title: "ServiceNow Developer", skills: ["glide", "servicenow"] },
  { id: "snowflake-developer", title: "Snowflake Developer", skills: ["snowflake"] },
  { id: "vb-net-developer", title: "VB.NET Developer", skills: ["vbdot-net"] },
  { id: "react-native-developer", title: "React Native Developer", skills: ["react", "react-native"] },
  { id: "rust-developer", title: "Rust Developer", skills: ["algorithms", "rust"] },
  { id: "java-developer-java", title: "Java Developer (Java/Algorithms/Spring)", skills: ["java", "algorithms", "spring"] },
  { id: "r-developer", title: "R Developer", skills: ["r", "algorithms"] },
  { id: "java-developer-java-64", title: "Java Developer (Java/JMeter)", skills: ["java", "jmeter"] },
  { id: "mysql-developer", title: "MySQL Developer", skills: ["sql"] },
  { id: "mssql-developer", title: "MSSQL Developer", skills: ["mssql", "sql"] },
  { id: "postgresql-developer", title: "PostgreSQL Developer", skills: ["sql", "postgresql"] },
  { id: "oracle-developer", title: "Oracle Developer", skills: ["sql", "oracle"] },
  { id: "t-sql-developer", title: "T-SQL Developer", skills: ["sql", "t-sql"] },
  { id: "mongodb-developer", title: "MongoDB Developer", skills: ["mongodb"] },
  { id: "nosql-developer", title: "NoSQL Developer", skills: ["mongodb"] },
  { id: "redis-developer", title: "Redis Developer", skills: ["docker", "redis"] },
  { id: "dart-developer", title: "Dart Developer", skills: ["dart", "flutter"] },
  { id: "c-developer", title: "C# Developer", skills: ["c-sharp", "dot-net"] },
  { id: "blazor-developer", title: "Blazor Developer", skills: ["c-sharp", "dot-net", "blazor"] },
  { id: "c-security", title: "C# Security", skills: ["c-sharp", "dot-net"] },
  { id: "asp-net-developer", title: "ASP.NET Developer", skills: ["c-sharp", "dot-net"] },
  { id: "net-developer", title: ".Net Developer", skills: ["c-sharp", "dot-net"] },
  { id: "salesforce-developer", title: "Salesforce Developer", skills: ["apex", "salesforce", "security"] },
  { id: "pentest-developer", title: "Pentest Developer", skills: ["bash", "security", "linux"] },
  { id: "apex-developer", title: "Apex Developer", skills: ["apex", "salesforce"] },
  { id: "sales-representative", title: "Sales Representative", skills: ["sales-development"] },
  { id: "java-developer-java-83", title: "Java Developer (Java/API/Spring)", skills: ["java", "api", "spring"] },
  { id: "clojure-developer", title: "Clojure Developer", skills: ["clojure", "algorithms"] },
  { id: "elixir-developer", title: "Elixir Developer", skills: ["elixir", "algorithms"] },
  { id: "data-analyst-spreadsheet", title: "Data Analyst (Spreadsheet)", skills: ["spreadsheet", "excel"] },
  { id: "looker-developer", title: "Looker Developer", skills: ["sql", "looker"] },
  { id: "data-analyst-sql", title: "Data Analyst (SQL)", skills: ["sql", "tableau"] },
  { id: "python-developer", title: "Python Developer", skills: ["python", "algorithms"] },
  { id: "fastapi-developer", title: "FastAPI Developer", skills: ["python", "fastapi", "rest"] },
  { id: "c-developer-91", title: "C++ Developer", skills: ["c-plus-plus", "algorithms"] },
  { id: "c-oop-developer", title: "C++ OOP Developer", skills: ["c-plus-plus", "algorithms", "oop"] },
  { id: "ruby-developer", title: "Ruby Developer", skills: ["ruby", "ruby-on-rails"] },
  { id: "ruby-on-rails", title: "Ruby on Rails", skills: ["ruby", "ruby-on-rails"] },
  { id: "kotlin-developer", title: "Kotlin Developer", skills: ["kotlin", "android"] },
  { id: "typescript-developer", title: "TypeScript Developer", skills: ["typescript", "node-js", "javascript"] },
  { id: "product-manager-jira", title: "Product Manager (Jira)", skills: ["jira", "agile"] },
  { id: "project-manager-agile", title: "Project Manager (Agile)", skills: ["agile"] },
  { id: "project-manager-scrum", title: "Project Manager (Scrum)", skills: ["scrum", "agile"] },
  { id: "microsoft-365-developer", title: "Microsoft 365 Developer", skills: ["sharepoint", "azure", "power-apps"] },
  { id: "project-manager-jira", title: "Project Manager (Jira)", skills: ["jira", "agile"] },
  { id: "project-manager-airtable", title: "Project Manager (Airtable)", skills: ["airtable", "no-code"] },
  { id: "product-manager-asana", title: "Product Manager (Asana)", skills: ["asana"] },
  { id: "product-manager-trello", title: "Product Manager (Trello)", skills: ["trello"] },
  { id: "shopify-developer", title: "Shopify Developer", skills: ["shopify", "no-code"] },
  { id: "logical-reasoning", title: "Logical Reasoning", skills: ["problem-solving"] },
  { id: "customer-service", title: "Customer Service", skills: ["customer-service"] },
  { id: "customer-support", title: "Customer Support", skills: ["customer-support"] },
  { id: "customer-success", title: "Customer Success", skills: ["agile"] },
  { id: "designer", title: "Designer", skills: ["figma"] },
  { id: "firebase", title: "Firebase", skills: ["firebase", "cloud"] },
  { id: "3d-image-processing", title: "3D Image Processing", skills: ["3d", "image-processing"] },
  { id: "computer-vision", title: "Computer Vision", skills: ["computer-vision"] },
  { id: "unity-developer", title: "Unity Developer", skills: ["unity"] },
  { id: "unreal-engine-developer", title: "Unreal Engine Developer", skills: ["unreal"] },
  { id: "human-resources", title: "Human Resources", skills: [] },
  { id: "web-accessibility-aria", title: "Web Accessibility (ARIA)", skills: ["accessibility"] },
  { id: "marketing-analyst-marketing", title: "Marketing Analyst (Marketing)", skills: ["marketing", "seo", "problem-solving"] },
  { id: "business-analyst", title: "Business Analyst", skills: ["analyst", "problem-solving"] },
  { id: "marketing-analyst-hubspot", title: "Marketing Analyst (HubSpot)", skills: ["hubspot", "no-code"] },
  { id: "ibm-analytics", title: "IBM Analytics", skills: ["ibm-cognos"] },
  { id: "sap-developer", title: "SAP Developer", skills: ["abap", "sap"] },
  { id: "network-engineer", title: "Network Engineer", skills: ["bash", "linux", "network", "security"] },
  { id: "web-security", title: "Web Security", skills: ["javascript", "linux", "security", "pentest"] },
  { id: "cybersecurity", title: "Cybersecurity", skills: ["bash", "linux", "network", "security", "pentest"] },
  { id: "cucumber-bdd", title: "Cucumber BDD", skills: ["cucumber"] },
  { id: "compliance", title: "Compliance", skills: ["soc-2"] },
  { id: "azure-developer", title: "Azure Developer", skills: ["bash", "active-directory", "azure"] },
  { id: "azure-devops", title: "Azure DevOps", skills: ["azure", "active-directory"] },
  { id: "microsoft-dynamics-365", title: "Microsoft Dynamics 365", skills: ["microsoft-dynamics-365"] },
  { id: "rpa-developer", title: "RPA Developer", skills: ["uipath"] },
  { id: "automation-anywhere", title: "Automation Anywhere", skills: ["automation-anywhere"] },
  { id: "numerical-reasoning", title: "Numerical Reasoning", skills: ["numerical-reasoning"] },
  { id: "blue-prism-developer", title: "Blue Prism Developer", skills: ["blue-prism"] },
  { id: "selenium-developer-selenium", title: "Selenium Developer (Selenium/Python)", skills: ["selenium", "python"] },
  { id: "playwright-developer", title: "Playwright Developer", skills: ["playwright", "python"] },
  { id: "selenium-developer-selenium-137", title: "Selenium Developer (Selenium/C#)", skills: ["selenium", "c-sharp"] },
  { id: "selenium-developer-selenium-138", title: "Selenium Developer (Selenium/Java)", skills: ["selenium", "java"] },
  { id: "junit-testing", title: "JUnit Testing", skills: ["java", "junit"] },
  { id: "mockito-testing", title: "Mockito Testing", skills: ["java", "mockito"] },
  { id: "qa-developer", title: "QA Developer", skills: ["cypress"] },
  { id: "manual-qa", title: "Manual QA", skills: ["manual-testing", "selenium"] },
  { id: "technical-support-engineer", title: "Technical Support Engineer", skills: ["manual-testing", "system-design", "linux"] },
  { id: "software-architect", title: "Software Architect", skills: ["bash", "system-design", "linux"] },
  { id: "ui-developer", title: "UI Developer", skills: ["ui", "figma"] },
  { id: "ux-research", title: "UX Research", skills: ["ux-research"] },
  { id: "microservices", title: "Microservices", skills: ["system-design", "microservices"] },
];

const TITLES = ROLES;   // old name, kept so existing callers keep working
const BY_ID = new Map(ROLES.map((t) => [t.id, t]));
function byId(id) { return BY_ID.get(id) || null; }

// Closest BLS occupation for the pay tip; roles with no good match get none.
function socFor(role) {
  const t = role.title.toLowerCase();
  if (/(security|pentest|penetration|soc analyst)/.test(t)) return '15-1212';
  if (/(data scien|machine learning|data engineer|data analyst|\bdata\b|pandas)/.test(t)) return '15-2051';
  if (/(\bqa\b|test|selenium|cypress|playwright|appium)/.test(t)) return '15-1253';
  if (/(database|\bdba\b|sql server)/.test(t)) return '15-1242';
  if (/(support|help desk)/.test(t)) return '15-1232';
  if (/(network|system admin)/.test(t)) return '15-1244';
  if (/(developer|engineer|programmer|devops)/.test(t)) return '15-1252';
  return null;
}
const ROLE_SOC = {};
for (const r of ROLES) { const s = socFor(r); if (s) ROLE_SOC[r.id] = s; }

// Roles whose title or skills match what the recruiter typed. Every typed word must appear somewhere.
function searchRoles(q, limit = 12) {
  const words = String(q || '').toLowerCase().split(/[^a-z0-9#+.]+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const r of ROLES) {
    const title = r.title.toLowerCase();
    const hay = title + ' ' + r.skills.join(' ').replace(/-/g, ' ');
    if (!words.every((w) => hay.includes(w))) continue;
    const inTitle = words.filter((w) => title.includes(w)).length;
    scored.push({ r, score: inTitle * 10 - r.title.length / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.r);
}

// Roles that cover every skill key given (so fewer picked skills means more roles to choose from).
function titlesForSkills(skillKeys) {
  const keys = [...new Set((skillKeys || []).filter(Boolean))];
  if (!keys.length) return [];
  return ROLES.filter((t) => keys.every((k) => t.skills.includes(k)))
    .sort((a, b) => a.skills.length - b.skills.length || a.title.localeCompare(b.title));
}

module.exports = { ROLES, TITLES, ROLE_SOC, byId, searchRoles, titlesForSkills };
