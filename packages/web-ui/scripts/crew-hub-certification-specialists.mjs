/**
 * World-renowned professional certification study coaches — cloud, security, finance,
 * medical boards, project management, networking, data, HR, legal, and more.
 * Each role maps to a specific credential with exam-domain expertise for FTS search.
 */

const certTraits = [
  'methodical', 'encouraging', 'detail-oriented', 'exam-focused',
  'patient', 'analytical', 'practical', 'thorough',
];

/** @typedef {{ title: string; examCode: string; certBody: string; examDomains: string[]; specialty?: string; certPrep: true; expertise?: string[]; secondaryCerts?: string[] }} CertPrepRole */

/**
 * @param {string} title Globally unique job title (include exam code)
 * @param {string} examCode Official exam identifier (e.g. SAA-C03)
 * @param {string} certBody Issuing body (e.g. AWS, Microsoft, PMI)
 * @param {string[]} examDomains Exam blueprint domains / knowledge areas
 * @param {string} [specialty]
 * @param {string[]} [secondaryCerts] Additional credentials this coach also holds
 */
export function certPrepRole(title, examCode, certBody, examDomains, specialty, secondaryCerts = []) {
  const domainLine = examDomains.join(', ');
  const spec = specialty
    ?? `${certBody} ${examCode} certification exam preparation — domain mastery, study planning, and scenario-based coaching across ${domainLine}`;
  const extraExpertise = [
    examCode,
    certBody,
    'Certification Exam Prep',
    'Study Plan Design',
    ...secondaryCerts,
  ];
  return {
    title,
    examCode,
    certBody,
    examDomains,
    specialty: spec,
    certPrep: true,
    expertise: [...new Set([...examDomains, ...extraExpertise])].slice(0, 12),
    secondaryCerts,
  };
}

/**
 * @param {string} body
 * @param {string} code
 * @param {string} name
 * @param {string[]} domains
 * @param {string[]} [secondaryCerts]
 */
function exam(body, code, name, domains, secondaryCerts = []) {
  return certPrepRole(
    `${body} ${code} ${name} Study Coach`,
    code,
    body,
    domains,
    undefined,
    secondaryCerts,
  );
}

/** @param {[string, string, string, string[]][]} rows [body, code, name, domains] */
function examsFromRows(rows) {
  return rows.map(([body, code, name, domains]) => exam(body, code, name, domains));
}

const AWS_EXAMS = [
  ['AWS', 'CLF-C02', 'Cloud Practitioner', ['Cloud concepts', 'Security and compliance', 'Cloud technology and services', 'Billing pricing and support']],
  ['AWS', 'AIF-C01', 'AI Practitioner', ['Fundamentals of AI and ML', 'Generative AI', 'Applications of foundation models', 'Guidelines for responsible AI']],
  ['AWS', 'SAA-C03', 'Solutions Architect Associate', ['Design resilient architectures', 'Design high-performing architectures', 'Design secure applications and architectures', 'Design cost-optimized architectures']],
  ['AWS', 'DVA-C02', 'Developer Associate', ['Development with AWS services', 'Security', 'Deployment', 'Troubleshooting and optimization']],
  ['AWS', 'SOA-C03', 'SysOps Administrator Associate', ['Monitoring logging and remediation', 'Reliability and business continuity', 'Deployment provisioning and automation', 'Security and compliance', 'Networking and content delivery', 'Cost and performance optimization']],
  ['AWS', 'DEA-C01', 'Data Engineer Associate', ['Data ingestion and transformation', 'Data store management', 'Data operations and support', 'Data security and governance']],
  ['AWS', 'MLA-C01', 'Machine Learning Engineer Associate', ['Data preparation for ML', 'ML model development', 'Deployment and orchestration of ML workflows', 'ML solution monitoring and maintenance']],
  ['AWS', 'DOP-C02', 'DevOps Engineer Professional', ['SDLC automation', 'Configuration management and IaC', 'Resilient cloud solutions', 'Monitoring and logging', 'Incident and event response', 'Security and compliance']],
  ['AWS', 'SAP-C02', 'Solutions Architect Professional', ['Design solutions for organizational complexity', 'Design for new solutions', 'Continuous improvement for existing solutions', 'Accelerate workload migration and modernization'], ['SAA-C03']],
  ['AWS', 'DOP-C02', 'DevOps Engineer Professional Advanced Coach', ['CI/CD pipelines', 'Infrastructure as code', 'Observability', 'Security automation', 'Resilience patterns', 'Governance'], ['SOA-C03']],
  ['AWS', 'MLS-C01', 'Machine Learning Specialty', ['Data engineering', 'Exploratory data analysis', 'Modeling', 'ML implementation and operations', 'ML best practices']],
  ['AWS', 'SCS-C02', 'Security Specialty', ['Incident response', 'Logging and monitoring', 'Infrastructure security', 'Identity and access management', 'Data protection', 'Management and security governance']],
  ['AWS', 'ANS-C01', 'Advanced Networking Specialty', ['Network design', 'Network implementation', 'Network management and operation', 'Network security compliance and governance']],
  ['AWS', 'DBS-C01', 'Database Specialty', ['Workload-specific database design', 'Migration and consolidation', 'Management and operations', 'Monitoring and troubleshooting']],
  ['AWS', 'DAS-C01', 'Data Analytics Specialty', ['Collection', 'Storage and data management', 'Processing', 'Analysis and visualization', 'Security']],
  ['AWS', 'PAS-C01', 'SAP on AWS Specialty', ['Design SAP on AWS', 'Implement SAP on AWS', 'Operate SAP on AWS', 'Lift and shift SAP workloads']],
  ['AWS', 'MLS-C01', 'Machine Learning Specialty Advanced', ['Feature engineering', 'Model training', 'SageMaker pipelines', 'MLOps', 'Responsible AI']],
  ['AWS', 'SOA-C03', 'Cloud Operations Engineer Associate', ['Operations best practices', 'Automation', 'Networking', 'Security operations', 'Cost optimization']],
  ['AWS', 'SAA-C03', 'Associate Solutions Architect Exam Mentor', ['Well-Architected Framework', 'VPC design', 'S3 and storage', 'Compute services', 'High availability']],
  ['AWS', 'SAP-C02', 'Professional Solutions Architect Exam Mentor', ['Multi-account strategy', 'Hybrid connectivity', 'Migration at scale', 'Cost governance', 'Security architecture'], ['SAA-C03', 'ANS-C01']],
  ['AWS', 'DVA-C02', 'Serverless Developer Certification Coach', ['Lambda', 'API Gateway', 'DynamoDB', 'Event-driven design', 'CI/CD for serverless']],
  ['AWS', 'SCS-C02', 'Cloud Security Architect Certification Coach', ['KMS', 'IAM advanced', 'GuardDuty', 'Security Hub', 'Zero trust on AWS'], ['SAA-C03']],
];

const AZURE_EXAMS = [
  ['Microsoft', 'AZ-900', 'Azure Fundamentals', ['Cloud concepts', 'Azure architecture and services', 'Azure management and governance', 'Azure security privacy and compliance']],
  ['Microsoft', 'AI-900', 'Azure AI Fundamentals', ['AI workloads', 'Machine learning on Azure', 'Computer vision', 'Natural language processing', 'Generative AI']],
  ['Microsoft', 'DP-900', 'Azure Data Fundamentals', ['Core data concepts', 'Relational data on Azure', 'Non-relational data on Azure', 'Analytics workloads']],
  ['Microsoft', 'SC-900', 'Security Compliance and Identity Fundamentals', ['Security compliance and identity concepts', 'Microsoft Entra', 'Microsoft security capabilities', 'Microsoft compliance capabilities']],
  ['Microsoft', 'AZ-104', 'Azure Administrator Associate', ['Manage Azure identities and governance', 'Implement and manage storage', 'Deploy and manage Azure compute', 'Configure and manage virtual networking', 'Monitor and maintain Azure resources']],
  ['Microsoft', 'AZ-204', 'Azure Developer Associate', ['Develop Azure compute solutions', 'Develop for Azure storage', 'Implement Azure security', 'Monitor troubleshoot and optimize', 'Connect to and consume Azure services']],
  ['Microsoft', 'AZ-305', 'Azure Solutions Architect Expert', ['Design identity and security', 'Design data storage solutions', 'Design business continuity', 'Design infrastructure solutions'], ['AZ-104']],
  ['Microsoft', 'AZ-400', 'Azure DevOps Engineer Expert', ['Design and implement source control', 'Design and implement build and release pipelines', 'Design and implement dependency management', 'Design and implement application infrastructure', 'Implement continuous feedback'], ['AZ-104', 'AZ-204']],
  ['Microsoft', 'AZ-500', 'Azure Security Engineer Associate', ['Secure identity and access', 'Secure networking', 'Secure compute storage and data', 'Manage security operations']],
  ['Microsoft', 'AZ-700', 'Azure Network Engineer Associate', ['Design implement and manage connectivity services', 'Design implement and manage core networking', 'Design implement and manage network security', 'Design implement and manage hybrid networking']],
  ['Microsoft', 'AZ-800', 'Windows Server Hybrid Administrator Associate', ['Deploy and manage AD DS', 'Manage Windows Servers in hybrid environments', 'Manage virtual machines and containers', 'Implement and manage on-premises and hybrid networking']],
  ['Microsoft', 'AZ-801', 'Windows Server Hybrid Administrator Associate Advanced', ['Implement and manage hybrid identity', 'Manage Windows Server HA and DR', 'Manage Windows Server security', 'Migrate servers and workloads']],
  ['Microsoft', 'SC-200', 'Security Operations Analyst Associate', ['Mitigate threats using Microsoft security solutions', 'Configure and deploy security operations', 'Investigate and respond to security incidents']],
  ['Microsoft', 'SC-300', 'Identity and Access Administrator Associate', ['Implement an identity management solution', 'Implement authentication and access management', 'Plan and implement identity governance']],
  ['Microsoft', 'SC-400', 'Information Protection Administrator Associate', ['Implement information protection', 'Implement data loss prevention', 'Implement data lifecycle and records management']],
  ['Microsoft', 'SC-100', 'Cybersecurity Architect Expert', ['Design a Zero Trust strategy', 'Evaluate governance risk and compliance', 'Design security operations', 'Design security for infrastructure', 'Design security for applications and data']],
  ['Microsoft', 'DP-203', 'Azure Data Engineer Associate', ['Design and implement data storage', 'Design and develop data processing', 'Design and implement data security', 'Monitor and optimize data solutions']],
  ['Microsoft', 'DP-300', 'Azure Database Administrator Associate', ['Plan and implement data platform resources', 'Implement a secure environment', 'Monitor and optimize operational resources', 'Optimize query performance', 'Perform automation of tasks', 'Plan and implement HA and DR']],
  ['Microsoft', 'DP-600', 'Fabric Analytics Engineer Associate', ['Implement and manage semantic models', 'Identify and connect to data sources', 'Prepare data for analysis', 'Manage and secure semantic models']],
  ['Microsoft', 'DP-700', 'Fabric Data Engineer Associate', ['Implement and manage an analytics solution', 'Ingest and transform data', 'Monitor and optimize an analytics solution']],
  ['Microsoft', 'AI-102', 'Azure AI Engineer Associate', ['Plan and manage Azure AI solutions', 'Implement decision support solutions', 'Implement computer vision solutions', 'Implement NLP solutions', 'Implement knowledge mining and document intelligence']],
  ['Microsoft', 'AZ-305', 'Azure Cloud Architect Certification Mentor', ['Landing zones', 'Azure Arc', 'AKS architecture', 'Cost management', 'Governance at scale'], ['AZ-104', 'AZ-500']],
];

const GCP_EXAMS = [
  ['Google Cloud', 'CDL', 'Cloud Digital Leader', ['Digital transformation with Google Cloud', 'Infrastructure and application modernization', 'Innovating with data and AI', 'Google Cloud security and operations']],
  ['Google Cloud', 'ACE', 'Associate Cloud Engineer', ['Setting up a cloud solution environment', 'Planning and configuring a cloud solution', 'Deploying and implementing a cloud solution', 'Ensuring successful operation of a cloud solution', 'Configuring access and security']],
  ['Google Cloud', 'PCA', 'Professional Cloud Architect', ['Designing and planning a cloud solution architecture', 'Managing and provisioning a solution infrastructure', 'Designing for security and compliance', 'Analyzing and optimizing technical and business processes', 'Managing implementations', 'Ensuring solution and operations reliability']],
  ['Google Cloud', 'PCD', 'Professional Cloud Developer', ['Designing highly scalable cloud applications', 'Building and testing applications', 'Deploying applications', 'Integrating Google Cloud services', 'Managing application performance monitoring']],
  ['Google Cloud', 'PDE', 'Professional Data Engineer', ['Designing data processing systems', 'Ingesting and processing data', 'Storing data', 'Preparing and using data for analysis', 'Maintaining and automating data workloads']],
  ['Google Cloud', 'PCNE', 'Professional Cloud Network Engineer', ['Designing planning and prototyping a GCP network', 'Implementing a VPC network', 'Configuring network services', 'Implementing hybrid connectivity', 'Managing and monitoring network operations']],
  ['Google Cloud', 'PCSE', 'Professional Cloud Security Engineer', ['Configuring access within a cloud solution environment', 'Configuring network security', 'Ensuring data protection', 'Managing operations in a cloud solution environment', 'Ensuring compliance']],
  ['Google Cloud', 'PCDO', 'Professional Cloud DevOps Engineer', ['Bootstrapping a Google Cloud organization for DevOps', 'Building and implementing CI/CD pipelines', 'Implementing service monitoring strategies', 'Optimizing service performance', 'Managing incidents and troubleshooting']],
  ['Google Cloud', 'PMLE', 'Professional Machine Learning Engineer', ['Architecting low-code ML solutions', 'Collaborating to manage ML solutions', 'Scaling prototypes into ML models', 'Serving and scaling models', 'Automating and orchestrating ML pipelines']],
  ['Google Cloud', 'PCLOUD', 'Professional Collaboration Engineer', ['Planning and implementing Google Workspace authorization', 'Managing users resources and shared drives', 'Managing mail compliance and security', 'Configuring advanced Google Workspace administration']],
  ['Google Cloud', 'GCA', 'Google Cloud Associate Certification Coach', ['Compute Engine', 'GKE basics', 'Cloud Storage', 'IAM', 'Billing']],
  ['Google Cloud', 'PCA', 'Multi-Region Cloud Architect Coach', ['Global load balancing', 'Spanner', 'Anthos', 'Cloud CDN', 'Disaster recovery'], ['ACE']],
  ['Google Cloud', 'PDE', 'BigQuery Data Engineering Coach', ['BigQuery architecture', 'Dataflow', 'Pub/Sub', 'Dataproc', 'Data governance']],
  ['Google Cloud', 'PCSE', 'BeyondCorp Security Architect Coach', ['VPC Service Controls', 'Cloud Armor', 'Security Command Center', 'KMS', 'Binary Authorization']],
  ['Google Cloud', 'ACE', 'GKE Associate Deployment Coach', ['GKE clusters', 'Workloads', 'Networking', 'Observability', 'Security basics']],
  ['Google Cloud', 'PCA', 'FinOps on GCP Architect Coach', ['Billing exports', 'Recommender', 'Committed use discounts', 'Resource hierarchy', 'Labeling strategy']],
  ['Google Cloud', 'PDE', 'Streaming Analytics Certification Coach', ['Dataflow streaming', 'BigQuery streaming', 'Pub/Sub', 'Flink on Dataproc', 'Schema design']],
  ['Google Cloud', 'PCNE', 'Hybrid Cloud Network Coach', ['Cloud VPN', 'Cloud Interconnect', 'Cloud Router', 'Private Service Connect', 'DNS hybrid']],
  ['Google Cloud', 'PMLE', 'Vertex AI ML Engineer Coach', ['Vertex AI Pipelines', 'Feature Store', 'Model Registry', 'AutoML', 'Responsible AI']],
  ['Google Cloud', 'PCDO', 'SRE on GCP Certification Coach', ['SLOs and SLIs', 'Error budgets', 'Incident management', 'Chaos engineering', 'Observability stack']],
  ['Google Cloud', 'PCA', 'Professional Cloud Architect Exam Strategist', ['Case study approach', 'Trade-off analysis', 'Migration patterns', 'Security by design', 'Cost optimization']],
];

const MULTICLOUD_EXAMS = [
  ['Oracle', 'OCI-ACA', 'OCI Architect Associate', ['Core OCI services', 'Networking', 'Compute and storage', 'IAM', 'High availability']],
  ['Oracle', 'OCI-ACP', 'OCI Architect Professional', ['Hybrid cloud', 'Migration', 'Security architecture', 'Cost governance', 'Multi-region design']],
  ['IBM', 'C1000-172', 'IBM Cloud Solutions Architect v2', ['IBM Cloud architecture', 'Hybrid cloud', 'Security', 'DevOps on IBM Cloud', 'Data and AI services']],
  ['Alibaba', 'ACA-Cloud', 'Alibaba Cloud Associate', ['Elastic compute', 'Storage', 'VPC', 'Security', 'Billing']],
  ['Alibaba', 'ACP-Cloud', 'Alibaba Cloud Professional', ['Architecture design', 'Migration', 'Big data on Alibaba', 'Security compliance', 'Operations']],
  ['VMware', 'VCP-DCV', 'VMware Certified Professional Data Center Virtualization', ['vSphere installation', 'Networking', 'Storage', 'Resource management', 'Troubleshooting']],
  ['VMware', 'VCP-NV', 'VMware NSX Professional', ['NSX architecture', 'Logical switching and routing', 'Security policies', 'Operations', 'Troubleshooting']],
  ['Red Hat', 'EX200', 'RHCSA Certification Coach', ['Essential tools', 'Operate running systems', 'Configure local storage', 'Create and configure file systems', 'Deploy configure and maintain systems', 'Manage users and groups', 'Security basics']],
  ['Red Hat', 'EX294', 'RHCE Certification Coach', ['Ansible fundamentals', 'Manage variables and facts', 'Implement task control', 'Create Ansible roles', 'Configure systems for Ansible automation']],
  ['Salesforce', 'ADM-201', 'Salesforce Administrator', ['Organization setup', 'User setup', 'Security and access', 'Standard and custom objects', 'Sales and marketing applications', 'Service and support applications', 'Activity management and collaboration', 'Data management', 'Analytics reports and dashboards', 'Workflow and process automation', 'Desktop and mobile administration', 'AppExchange']],
  ['Salesforce', 'PD1', 'Platform Developer I', ['Developer fundamentals', 'Process automation and logic', 'User interface', 'Testing debugging and deployment', 'Integration and data management']],
  ['ServiceNow', 'CSA', 'Certified System Administrator', ['User interfaces', 'Collaboration', 'Database administration', 'Self-service and automation', 'Intro to development', 'Data migration', 'Configure applications for collaboration', 'Knowledge management', 'Configure UI policies and actions', 'Application security', 'Configure incoming email and notifications', 'MID server', 'Configure import sets and transform maps', 'Events and scheduled jobs', 'Configure virtual agent', 'Configure reporting and dashboards', 'Configure service catalog', 'Configure change and release management', 'Configure asset management', 'Configure CMDB']],
  ['SAP', 'C_TS410', 'SAP S/4HANA Certification Coach', ['SAP navigation', 'Logistics', 'Financial accounting basics', 'Procurement', 'Manufacturing']],
  ['Kubernetes', 'KCNA', 'Kubernetes and Cloud Native Associate', ['Kubernetes fundamentals', 'Container orchestration', 'Cloud native architecture', 'Cloud native observability', 'Cloud native application delivery']],
  ['HashiCorp', 'Terraform-Associate', 'Terraform Associate', ['Infrastructure as code concepts', 'Terraform basics', 'Core workflow', 'Terraform modules', 'Terraform cloud and enterprise capabilities']],
  ['HashiCorp', 'Vault-Associate', 'Vault Associate', ['Vault architecture', 'Authentication and authorization', 'Secrets engines', 'Policies', 'Operations']],
  ['Docker', 'DCA', 'Docker Certified Associate', ['Orchestration', 'Image creation management and registry', 'Installation and configuration', 'Networking', 'Security', 'Storage and volumes', 'Configuration and logging']],
  ['Linux Foundation', 'LFCS', 'Linux Foundation Certified System Administrator', ['Essential commands', 'Operation of running systems', 'User and group management', 'Networking', 'Storage', 'Services']],
  ['Linux Foundation', 'CKA', 'Certified Kubernetes Administrator', ['Cluster architecture', 'Workloads and scheduling', 'Services and networking', 'Storage', 'Troubleshooting']],
  ['Linux Foundation', 'CKAD', 'Certified Kubernetes Application Developer', ['Core concepts', 'Configuration', 'Multi-container pods', 'Observability', 'Pod design', 'Services and networking', 'State persistence']],
  ['Linux Foundation', 'CKS', 'Certified Kubernetes Security Specialist', ['Cluster setup', 'Cluster hardening', 'Minimize microservice vulnerabilities', 'Supply chain security', 'Monitoring logging and runtime security']],
];

const SECURITY_EXAMS = [
  ['ISC2', 'CISSP', 'Certified Information Systems Security Professional', ['Security and risk management', 'Asset security', 'Security architecture and engineering', 'Communication and network security', 'Identity and access management', 'Security assessment and testing', 'Security operations', 'Software development security']],
  ['ISC2', 'CCSP', 'Certified Cloud Security Professional', ['Cloud concepts and architecture', 'Cloud data security', 'Cloud platform and infrastructure security', 'Cloud application security', 'Cloud security operations', 'Legal risk and compliance']],
  ['ISC2', 'SSCP', 'Systems Security Certified Practitioner', ['Security operations and administration', 'Access controls', 'Risk identification and monitoring', 'Incident response and recovery', 'Cryptography', 'Network and communications security', 'Systems and application security']],
  ['ISACA', 'CISM', 'Certified Information Security Manager', ['Information security governance', 'Information security risk management', 'Information security program', 'Incident management']],
  ['ISACA', 'CISA', 'Certified Information Systems Auditor', ['Information systems auditing process', 'Governance and management of IT', 'Information systems acquisition and development', 'Information systems operations and business resilience', 'Protection of information assets']],
  ['ISACA', 'CRISC', 'Certified in Risk and Information Systems Control', ['Governance', 'IT risk assessment', 'Risk response and reporting', 'IT and security']],
  ['CompTIA', 'Security+', 'Security+ Certification Coach', ['General security concepts', 'Threats vulnerabilities and mitigations', 'Security architecture', 'Security operations', 'Security program management and oversight']],
  ['CompTIA', 'CySA+', 'Cybersecurity Analyst Certification Coach', ['Security operations', 'Vulnerability management', 'Incident response and management', 'Reporting and communication', 'Compliance and assessment']],
  ['CompTIA', 'PenTest+', 'Penetration Testing Certification Coach', ['Planning and scoping', 'Information gathering and vulnerability scanning', 'Attacks and exploits', 'Reporting and communication', 'Tools and code analysis']],
  ['CompTIA', 'CASP+', 'Advanced Security Practitioner Coach', ['Security architecture', 'Security operations', 'Security engineering and cryptography', 'Governance risk and compliance', 'Security assessment and testing']],
  ['EC-Council', 'CEH', 'Certified Ethical Hacker', ['Reconnaissance', 'Scanning networks', 'Enumeration', 'System hacking', 'Malware threats', 'Sniffing', 'Social engineering', 'Denial of service', 'Session hijacking', 'Web application hacking', 'Wireless hacking', 'Cloud hacking']],
  ['Offensive Security', 'OSCP', 'Penetration Testing Certification Coach', ['Information gathering', 'Vulnerability scanning', 'Exploitation', 'Privilege escalation', 'Active Directory attacks', 'Buffer overflows', 'Web application attacks', 'Report writing']],
  ['Offensive Security', 'OSWE', 'Web Expert Certification Coach', ['Advanced web exploitation', 'Source code review', 'Authentication bypass', 'Deserialization', 'WAF bypass']],
  ['GIAC', 'GSEC', 'Security Essentials Certification Coach', ['Network security', 'Cryptography', 'Authentication', 'Linux security', 'Windows security', 'Incident handling']],
  ['GIAC', 'GPEN', 'Penetration Tester Certification Coach', ['Scanning and enumeration', 'Exploitation', 'Post-exploitation', 'Password attacks', 'Web application testing']],
  ['GIAC', 'GWAPT', 'Web Application Penetration Tester', ['Web application mapping', 'Authentication attacks', 'SQL injection', 'XSS', 'CSRF', 'API security']],
  ['GIAC', 'GXPN', 'Exploit Researcher and Advanced Penetration Tester', ['Advanced exploitation', 'Memory corruption', 'Bypass techniques', 'Custom exploit development']],
  ['Cloud Security Alliance', 'CCSK', 'Certificate of Cloud Security Knowledge', ['Cloud computing concepts', 'Governance and enterprise risk', 'Legal issues contracts and eDiscovery', 'Compliance and audit', 'Application security', 'Identity and access management', 'Infrastructure security', 'Data security and encryption', 'Security as a service', 'Virtualization and containers']],
  ['SANS', 'GCIH', 'Certified Incident Handler', ['Incident handling process', 'Computer crime laws', 'Hacker techniques', 'Malware analysis basics', 'Network traffic analysis']],
  ['SANS', 'GCFE', 'Certified Forensic Examiner', ['Digital forensics fundamentals', 'Windows forensics', 'Email forensics', 'Network forensics', 'Report writing']],
  ['PMI', 'PMP', 'Project Management Professional Security Program Coach', ['Security program governance', 'Risk registers', 'Stakeholder management for security initiatives']],
];

const NETWORKING_EXAMS = [
  ['Cisco', 'CCNA', 'Cisco Certified Network Associate', ['Network fundamentals', 'Network access', 'IP connectivity', 'IP services', 'Security fundamentals', 'Automation and programmability']],
  ['Cisco', 'CCNP-ENCOR', 'Enterprise Core Certification Coach', ['Architecture', 'Virtualization', 'Infrastructure', 'Network assurance', 'Security', 'Automation']],
  ['Cisco', 'CCNP-ENARSI', 'Enterprise Advanced Routing Certification Coach', ['Layer 3 technologies', 'VPN services', 'Infrastructure security', 'Infrastructure services', 'Automation']],
  ['Cisco', 'CCIE-ENT', 'Enterprise Infrastructure Expert Coach', ['Network design', 'Advanced routing', 'SD-WAN', 'Automation', 'Troubleshooting at scale']],
  ['Cisco', 'CCNP-SEC', 'Security Professional Certification Coach', ['Security concepts', 'Network security', 'Content security', 'Endpoint protection', 'Secure network access', 'VPN and encryption', 'Automation']],
  ['Cisco', 'DevNet-Associate', 'DevNet Associate Certification Coach', ['Software development and design', 'Understanding and using APIs', 'Cisco platforms and development', 'Application deployment and security', 'Infrastructure and automation', 'Network fundamentals']],
  ['Juniper', 'JNCIA-Junos', 'Junos Associate Certification Coach', ['Networking fundamentals', 'Junos OS fundamentals', 'User interfaces', 'Configuration basics', 'Operational monitoring']],
  ['Juniper', 'JNCIS-ENT', 'Enterprise Routing and Switching Specialist', ['Layer 2 switching', 'Layer 2 security', 'OSPF', 'IS-IS', 'BGP', 'High availability']],
  ['Palo Alto', 'PCNSA', 'Palo Alto Networks Certified Network Security Administrator', ['Palo Alto Networks portfolio', 'Initial configuration', 'Interface configuration', 'Security and NAT policies', 'App-ID and Content-ID', 'URL filtering', 'Decryption', 'Monitoring and reporting']],
  ['Palo Alto', 'PCNSE', 'Palo Alto Networks Certified Network Security Engineer', ['Plan', 'Deploy and configure', 'Operate', 'Configure and manage', 'Troubleshoot']],
  ['Fortinet', 'NSE4', 'Network Security Professional', ['FortiGate configuration', 'Firewall policies', 'VPN', 'UTM', 'Routing', 'High availability']],
  ['CompTIA', 'Network+', 'Network+ Certification Coach', ['Networking concepts', 'Network implementation', 'Network operations', 'Network security', 'Network troubleshooting']],
  ['CompTIA', 'Server+', 'Server+ Certification Coach', ['Server hardware', 'Server administration', 'Storage', 'Security', 'Networking', 'Disaster recovery', 'Troubleshooting']],
  ['F5', 'BIG-IP-101', 'Application Delivery Fundamentals', ['OSI model', 'Load balancing concepts', 'Application delivery', 'Security basics', 'Troubleshooting']],
  ['F5', 'LTM-301A', 'Local Traffic Manager Specialist', ['LTM configuration', 'Profiles', 'iRules', 'High availability', 'Troubleshooting']],
  ['Aruba', 'ACMA', 'Aruba Certified Mobility Associate', ['WLAN fundamentals', 'Aruba architecture', 'Mobility controllers', 'Security', 'Troubleshooting']],
  ['AWS', 'ANS-C01', 'Networking on AWS Certification Coach', ['VPC advanced', 'Transit Gateway', 'Direct Connect', 'Route 53', 'Load balancing']],
  ['Microsoft', 'AZ-700', 'Azure Network Certification Coach', ['ExpressRoute', 'VPN gateways', 'Azure Firewall', 'Private Link', 'DDoS protection']],
  ['Google Cloud', 'PCNE', 'Cloud Network Engineer Certification Coach', ['VPC design', 'Hybrid connectivity', 'Cloud NAT', 'Load balancing', 'Network security']],
  ['Cloudflare', 'CCNE', 'Certified Network Engineer Study Coach', ['DNS', 'CDN', 'WAF', 'Zero trust network access', 'DDoS mitigation']],
  ['Aviatrix', 'ACE', 'Multicloud Network Associate Coach', ['Cloud networking', 'Transit architecture', 'Security domains', 'Operations', 'Troubleshooting']],
];

const PM_AGILE_EXAMS = [
  ['PMI', 'CAPM', 'Certified Associate in Project Management', ['Project management fundamentals', 'Predictive plan-based methodologies', 'Agile frameworks', 'Business analysis frameworks', 'Tailoring']],
  ['PMI', 'PMP', 'Project Management Professional', ['People', 'Process', 'Business environment', 'Predictive agile and hybrid approaches']],
  ['PMI', 'PMI-ACP', 'Agile Certified Practitioner', ['Agile principles and mindset', 'Value-driven delivery', 'Stakeholder engagement', 'Team performance', 'Adaptive planning', 'Problem detection and resolution', 'Continuous improvement']],
  ['PMI', 'PMI-PBA', 'Professional in Business Analysis', ['Needs assessment', 'Planning', 'Analysis', 'Traceability and monitoring', 'Evaluation']],
  ['PMI', 'PgMP', 'Program Management Professional', ['Program strategy alignment', 'Program life cycle', 'Benefits management', 'Stakeholder engagement', 'Governance']],
  ['Scrum Alliance', 'CSM', 'Certified ScrumMaster', ['Scrum theory', 'Scrum roles', 'Scrum events', 'Scrum artifacts', 'Team facilitation']],
  ['Scrum Alliance', 'CSPO', 'Certified Scrum Product Owner', ['Product vision', 'Backlog management', 'Stakeholder engagement', 'Value maximization', 'Release planning']],
  ['Scrum.org', 'PSM-I', 'Professional Scrum Master I', ['Scrum framework', 'Scrum theory', 'Cross-functional teams', 'Done increment', 'Empiricism']],
  ['Scrum.org', 'PSM-II', 'Professional Scrum Master II', ['Facilitation', 'Coaching', 'Organizational change', 'Scaling Scrum', 'Metrics']],
  ['Scrum.org', 'PSPO-I', 'Professional Scrum Product Owner I', ['Product backlog', 'Value', 'Stakeholders', 'Agile product management', 'Release management']],
  ['Scaled Agile', 'SAFe-Agilist', 'SAFe Agilist Certification Coach', ['Lean-Agile principles', 'SAFe principles', 'PI planning', 'Agile release trains', 'Lean portfolio management']],
  ['Scaled Agile', 'SAFe-Scrum-Master', 'SAFe Scrum Master Certification Coach', ['Team events', 'Program events', 'Coaching Agile teams', 'DevOps and release on demand']],
  ['ICAgile', 'ICP-ACC', 'Agile Coaching Certification Coach', ['Coaching stance', 'Team dynamics', 'Organizational agility', 'Facilitation', 'Professional coaching skills']],
  ['ITIL', 'ITIL-4-Foundation', 'ITIL 4 Foundation', ['Service management concepts', 'Four dimensions', 'Service value system', 'ITIL practices', 'Continual improvement']],
  ['ITIL', 'ITIL-4-MP', 'ITIL 4 Managing Professional', ['Create deliver and support', 'Drive stakeholder value', 'High velocity IT', 'Direct plan and improve']],
  ['AXELOS', 'PRINCE2-Foundation', 'PRINCE2 Foundation', ['PRINCE2 principles', 'Themes', 'Processes', 'Tailoring', 'Business case']],
  ['AXELOS', 'PRINCE2-Practitioner', 'PRINCE2 Practitioner', ['Applying PRINCE2 in scenarios', 'Tailoring for context', 'Managing stages', 'Risk and quality', 'Change control']],
  ['IIBA', 'ECBA', 'Entry Certificate in Business Analysis', ['Business analysis knowledge areas', 'Underlying competencies', 'Techniques', 'Perspectives']],
  ['IIBA', 'CCBA', 'Certification of Capability in Business Analysis', ['Business analysis planning', 'Elicitation and collaboration', 'Requirements life cycle', 'Strategy analysis', 'Solution evaluation']],
  ['IIBA', 'CBAP', 'Certified Business Analysis Professional', ['Advanced business analysis', 'Complex requirements', 'Enterprise analysis', 'Solution assessment', 'Stakeholder management']],
  ['Lean', 'Lean-Six-Sigma-Green', 'Lean Six Sigma Green Belt', ['DMAIC', 'Process mapping', 'Statistical analysis basics', 'Root cause analysis', 'Control plans']],
  ['Lean', 'Lean-Six-Sigma-Black', 'Lean Six Sigma Black Belt', ['Advanced statistics', 'Design of experiments', 'Change management', 'Project leadership', 'Process optimization']],
  ['Kanban University', 'KMP-I', 'Kanban System Design', ['Kanban method', 'System design', 'Flow metrics', 'Classes of service', 'Feedback loops']],
];

const FINANCE_EXAMS = [
  ['AICPA', 'CPA', 'Certified Public Accountant Exam Coach', ['Auditing and attestation', 'Financial accounting and reporting', 'Regulation', 'Business environment and concepts']],
  ['CFA Institute', 'CFA-Level-I', 'Chartered Financial Analyst Level I Coach', ['Ethical and professional standards', 'Quantitative methods', 'Economics', 'Financial statement analysis', 'Corporate issuers', 'Equity investments', 'Fixed income', 'Derivatives', 'Alternative investments', 'Portfolio management']],
  ['CFA Institute', 'CFA-Level-II', 'Chartered Financial Analyst Level II Coach', ['Asset valuation', 'Portfolio management applications', 'Ethics application', 'Financial reporting analysis', 'Equity and fixed income valuation']],
  ['CFA Institute', 'CFA-Level-III', 'Chartered Financial Analyst Level III Coach', ['Portfolio management', 'Wealth planning', 'Behavioral finance', 'Trading execution', 'Performance evaluation', 'Ethics in practice']],
  ['IMA', 'CMA', 'Certified Management Accountant', ['External financial reporting decisions', 'Planning budgeting and forecasting', 'Performance management', 'Cost management', 'Internal controls', 'Technology and analytics', 'Financial statement analysis', 'Corporate finance', 'Decision analysis', 'Risk management', 'Investment decisions', 'Professional ethics']],
  ['ACCA', 'ACCA', 'Association of Chartered Certified Accountants Coach', ['Business and technology', 'Management accounting', 'Financial accounting', 'Corporate and business law', 'Performance management', 'Taxation', 'Audit and assurance', 'Financial management', 'Strategic business reporting', 'Strategic business leader']],
  ['GARP', 'FRM-Part-I', 'Financial Risk Manager Part I Coach', ['Foundations of risk management', 'Quantitative analysis', 'Financial markets and products', 'Valuation and risk models']],
  ['GARP', 'FRM-Part-II', 'Financial Risk Manager Part II Coach', ['Market risk', 'Credit risk', 'Operational risk', 'Liquidity risk', 'Investment management', 'Current issues in financial markets']],
  ['CFP Board', 'CFP', 'Certified Financial Planner Exam Coach', ['Professional conduct and regulation', 'General principles of financial planning', 'Risk management and insurance', 'Investment planning', 'Tax planning', 'Retirement savings and income planning', 'Estate planning', 'Psychology of financial planning']],
  ['IRS', 'EA', 'Enrolled Agent Certification Coach', ['Individuals', 'Businesses', 'Representation practices and procedures', 'Federal tax law', 'Ethics']],
  ['FINRA', 'Series-7', 'General Securities Representative Exam Coach', ['Seeks business for broker-dealer', 'Opens accounts', 'Provides customers with information', 'Makes suitable recommendations', 'Obtains and verifies customer purchase and sale instructions']],
  ['FINRA', 'Series-63', 'Uniform Securities Agent State Law Exam Coach', ['State securities regulation', 'Ethical practices', 'Registration requirements', 'Administrative provisions']],
  ['FINRA', 'Series-65', 'Uniform Investment Adviser Law Exam Coach', ['Economic factors', 'Investment vehicle characteristics', 'Client investment recommendations', 'Laws regulations and guidelines']],
  ['FINRA', 'Series-66', 'Uniform Combined State Law Exam Coach', ['Economic factors', 'Investment recommendations', 'Investment company products', 'Variable contracts', 'Registration requirements', 'Ethical practices']],
  ['CAIA', 'CAIA-Level-I', 'Chartered Alternative Investment Analyst Level I Coach', ['Introduction to alternative investments', 'Real assets', 'Hedge funds', 'Private equity', 'Structured products', 'Risk management']],
  ['CAIA', 'CAIA-Level-II', 'Chartered Alternative Investment Analyst Level II Coach', ['Portfolio management', 'Due diligence', 'Risk and performance measurement', 'Professional standards']],
  ['CIMA', 'CIMA', 'Chartered Institute of Management Accountants Coach', ['Enterprise operations', 'Performance management', 'Financial strategy', 'Risk management', 'Cost accounting', 'Strategic management']],
  ['SOA', 'SOA-FM', 'Society of Actuaries Financial Mathematics Coach', ['Interest theory', 'Annuities', 'Amortization', 'Bonds', 'Derivatives basics']],
  ['SOA', 'SOA-P', 'Society of Actuaries Probability Coach', ['Probability', 'Statistics', 'Risk models', 'Simulation', 'Credibility theory']],
  ['CII', 'Chartered-Insurance', 'Chartered Insurance Institute Certification Coach', ['Insurance principles', 'Underwriting', 'Claims', 'Regulation', 'Ethics']],
  ['CPCU', 'CPCU', 'Chartered Property Casualty Underwriter Coach', ['Risk management', 'Insurance operations', 'Underwriting', 'Claims', 'Ethics and legal']],
  ['ACAMS', 'CAMS', 'Certified Anti-Money Laundering Specialist', ['Money laundering risks', 'Compliance programs', 'Investigations', 'International standards', 'Sanctions']],
];

const DATA_ANALYTICS_EXAMS = [
  ['Databricks', 'Databricks-Associate', 'Databricks Data Engineer Associate', ['Databricks Lakehouse Platform', 'ELT with Spark SQL', 'Incremental data processing', 'Production pipelines', 'Data governance']],
  ['Databricks', 'Databricks-Professional', 'Databricks Data Engineer Professional', ['Security and compliance', 'Data processing', 'Monitoring and logging', 'Performance optimization', 'CI/CD for data']],
  ['Snowflake', 'SnowPro-Core', 'SnowPro Core Certification Coach', ['Snowflake architecture', 'Account access security', 'Performance concepts', 'Data loading and unloading', 'Data transformations', 'Data protection and sharing']],
  ['Snowflake', 'SnowPro-Advanced-Architect', 'SnowPro Advanced Architect Coach', ['Account and security design', 'Snowflake architecture', 'Data engineering', 'Performance optimization', 'Data sharing and marketplace']],
  ['Microsoft', 'PL-300', 'Power BI Data Analyst Associate', ['Prepare the data', 'Model the data', 'Visualize and analyze the data', 'Deploy and maintain assets']],
  ['Tableau', 'Tableau-Desktop-Specialist', 'Tableau Desktop Specialist Coach', ['Connecting to and preparing data', 'Exploring and analyzing data', 'Sharing insights', 'Understanding Tableau concepts']],
  ['Tableau', 'Tableau-Data-Analyst', 'Tableau Certified Data Analyst Coach', ['Connect to and transform data', 'Explore and analyze data', 'Publish and manage content', 'Design for performance']],
  ['Google', 'Google-Data-Analytics', 'Google Data Analytics Professional Certificate Coach', ['Data foundations', 'Ask questions to make data-driven decisions', 'Prepare data for exploration', 'Process data from dirty to clean', 'Analyze data', 'Share data through visualization', 'Data analysis with R']],
  ['Google', 'Google-Advanced-Data-Analytics', 'Google Advanced Data Analytics Certificate Coach', ['Foundations of data science', 'Get started with Python', 'Go beyond the numbers', 'The power of statistics', 'Regression analysis', 'The nuts and bolts of machine learning', 'Google Advanced Data Analytics Capstone']],
  ['MongoDB', 'MongoDB-Associate', 'MongoDB Associate Developer', ['MongoDB CRUD operations', 'Indexing', 'Aggregation', 'Data modeling', 'Drivers and applications']],
  ['MongoDB', 'MongoDB-Professional', 'MongoDB Professional Developer', ['Advanced schema design', 'Performance tuning', 'Replication', 'Sharding', 'Security']],
  ['Oracle', 'OCA-SQL', 'Oracle Database SQL Certified Associate', ['Relational database concepts', 'SQL SELECT statements', 'Restrictions and sorting', 'Conversion functions', 'Group functions', 'Multiple tables', 'DDL DML and transaction control']],
  ['Oracle', 'OCP-DBA', 'Oracle Database Administrator Certified Professional', ['Architecture', 'Installation and patching', 'Instance administration', 'Storage structures', 'Backup and recovery', 'Performance tuning']],
  ['PostgreSQL', 'PGCA', 'PostgreSQL Certified Associate Coach', ['SQL fundamentals', 'PostgreSQL architecture', 'Administration basics', 'Backup and restore', 'Performance basics']],
  ['Redis', 'Redis-Developer', 'Redis Certified Developer Coach', ['Data structures', 'Redis commands', 'Persistence', 'Replication', 'Clustering', 'Performance patterns']],
  ['Cloudera', 'CCA-Data-Analyst', 'Cloudera Certified Data Analyst', ['Data analysis with SQL', 'Hive and Impala', 'Data preparation', 'Reporting', 'Troubleshooting']],
  ['Cloudera', 'CCA-Spark', 'Cloudera Certified Spark Developer', ['Spark architecture', 'RDDs and DataFrames', 'Spark SQL', 'Performance tuning', 'Deployment']],
  ['Informatica', 'ICA', 'Informatica Certified Administrator Coach', ['Installation', 'Security', 'Repository management', 'Workflow monitoring', 'Performance tuning']],
  ['Talend', 'Talend-Core', 'Talend Data Integration Certification Coach', ['ETL design', 'Connectivity', 'Data quality', 'Job orchestration', 'Troubleshooting']],
  ['dbt', 'dbt-Analytics-Engineering', 'dbt Analytics Engineering Certification Coach', ['Modeling', 'Testing', 'Documentation', 'Deployment', 'Jinja and macros']],
  ['Alteryx', 'Alteryx-Designer-Core', 'Alteryx Designer Core Certification Coach', ['Data preparation', 'Blending', 'Spatial analytics', 'Reporting', 'Macros']],
  ['SAS', 'SAS-Base', 'SAS Base Programming Specialist Coach', ['SAS programming fundamentals', 'Data manipulation', 'Reporting', 'Error handling', 'SQL in SAS']],
];

const HR_LEGAL_EXAMS = [
  ['HRCI', 'PHR', 'Professional in Human Resources', ['Business management', 'Talent acquisition and retention', 'Learning and development', 'Total rewards', 'Employee and labor relations', 'HR information management']],
  ['HRCI', 'SPHR', 'Senior Professional in Human Resources', ['Leadership and strategy', 'Talent planning and acquisition', 'Learning and development', 'Total rewards', 'Employee relations and engagement', 'HR information management and technology']],
  ['SHRM', 'SHRM-CP', 'SHRM Certified Professional', ['Behavioral competencies', 'HR technical knowledge', 'People', 'Organization', 'Workplace', 'Strategy']],
  ['SHRM', 'SHRM-SCP', 'SHRM Senior Certified Professional', ['Leadership and navigation', 'Ethical practice', 'Business acumen', 'Relationship management', 'Consultation', 'Critical evaluation', 'Global and cultural effectiveness', 'Communication']],
  ['WorldatWork', 'CCP', 'Certified Compensation Professional Coach', ['Compensation strategy', 'Job analysis', 'Salary structures', 'Variable pay', 'Compliance', 'Communication']],
  ['WorldatWork', 'GRP', 'Global Remuneration Professional Coach', ['Global pay strategy', 'Mobility', 'Tax and compliance', 'Equity compensation', 'Benchmarking']],
  ['CIPD', 'CIPD-Level-5', 'CIPD Associate Diploma Coach', ['People management', 'Employment law', 'Learning and development', 'Reward management', 'HR analytics']],
  ['Bar Exam', 'UBE', 'Uniform Bar Examination Coach', ['Multistate Bar Examination', 'Multistate Essay Examination', 'Multistate Performance Test', 'Legal analysis', 'Issue spotting', 'Bar exam strategy']],
  ['LSAC', 'LSAT', 'Law School Admission Test Coach', ['Logical reasoning', 'Analytical reasoning', 'Reading comprehension', 'Writing sample strategy', 'Test pacing']],
  ['NALA', 'CP', 'Certified Paralegal Coach', ['Legal research', 'Civil litigation', 'Contracts', 'Ethics', 'Technology in law']],
  ['NALA', 'ACP', 'Advanced Certified Paralegal Coach', ['Specialized practice areas', 'Complex litigation support', 'E-discovery', 'Trial preparation', 'Ethics']],
  ['ACFE', 'CFE', 'Certified Fraud Examiner Coach', ['Financial transactions and fraud schemes', 'Law', 'Investigation', 'Fraud prevention and deterrence']],
  ['NCARB', 'ARE-5', 'Architect Registration Examination Coach', ['Practice management', 'Project management', 'Programming and analysis', 'Project planning and design', 'Project development and documentation', 'Construction and evaluation']],
  ['NCEES', 'FE', 'Fundamentals of Engineering Exam Coach', ['Mathematics', 'Probability and statistics', 'Engineering sciences', 'Ethics and professional practice', 'Engineering economics']],
  ['NCEES', 'PE-Civil', 'Professional Engineer Civil Exam Coach', ['Construction', 'Geotechnical', 'Structural', 'Transportation', 'Water resources and environmental']],
  ['NCEES', 'PE-Mechanical', 'Professional Engineer Mechanical Exam Coach', ['HVAC and refrigeration', 'Machine design', 'Thermal and fluid systems', 'Materials and mechanics']],
  ['NCEES', 'PE-Electrical', 'Professional Engineer Electrical Exam Coach', ['Power systems', 'Electronics and controls', 'Computer engineering', 'Safety codes']],
  ['LEED', 'LEED-AP', 'LEED Accredited Professional Coach', ['Location and transportation', 'Sustainable sites', 'Water efficiency', 'Energy and atmosphere', 'Materials and resources', 'Indoor environmental quality', 'Innovation', 'Regional priority']],
  ['PMI', 'PMI-RMP', 'Risk Management Professional Coach', ['Risk strategy and planning', 'Stakeholder engagement', 'Risk process facilitation', 'Risk monitoring and reporting', 'Perform specialized risk analyses']],
  ['PMI', 'PMI-SP', 'Scheduling Professional Coach', ['Schedule strategy and planning', 'Schedule development', 'Schedule maintenance', 'Schedule analysis', 'Schedule reporting']],
  ['ISO', 'ISO-9001-Lead-Auditor', 'ISO 9001 Lead Auditor Certification Coach', ['Quality management principles', 'Audit planning', 'Audit execution', 'Nonconformity reporting', 'Corrective action follow-up']],
  ['ISO', 'ISO-27001-Lead-Auditor', 'ISO 27001 Lead Auditor Certification Coach', ['ISMS concepts', 'Control objectives', 'Audit methodology', 'Risk-based auditing', 'Certification process']],
];

const MEDICAL_NURSING_EXAMS = [
  ['NBME', 'USMLE-Step-1', 'USMLE Step 1 Board Prep Coach', ['Biochemistry', 'Immunology', 'Microbiology', 'Pathology', 'Pharmacology', 'Physiology', 'Behavioral science']],
  ['NBME', 'USMLE-Step-2-CK', 'USMLE Step 2 Clinical Knowledge Coach', ['Internal medicine', 'Surgery', 'Pediatrics', 'Obstetrics and gynecology', 'Psychiatry', 'Preventive medicine']],
  ['NBME', 'USMLE-Step-3', 'USMLE Step 3 Board Prep Coach', ['Clinical encounter frames', 'Diagnosis', 'Health maintenance', 'Clinical interventions', 'Practice-based learning', 'Communication']],
  ['NCSBN', 'NCLEX-RN', 'NCLEX Registered Nurse Licensing Exam Coach', ['Management of care', 'Safety and infection control', 'Health promotion and maintenance', 'Psychosocial integrity', 'Basic care and comfort', 'Pharmacological therapies', 'Reduction of risk potential', 'Physiological adaptation']],
  ['NCSBN', 'NCLEX-PN', 'NCLEX Practical Nurse Licensing Exam Coach', ['Coordinated care', 'Safety and infection control', 'Health promotion', 'Psychosocial integrity', 'Basic care and comfort', 'Pharmacological therapies', 'Reduction of risk potential']],
  ['ABIM', 'ABIM-Board', 'Internal Medicine Board Certification Prep Coach', ['Cardiovascular disease', 'Endocrinology', 'Gastroenterology', 'Hematology', 'Infectious disease', 'Nephrology', 'Pulmonary disease', 'Rheumatology']],
  ['ABEM', 'ABEM-Board', 'Emergency Medicine Board Certification Prep Coach', ['Cardiovascular emergencies', 'Trauma', 'Toxicology', 'Pediatric emergencies', 'Environmental emergencies', 'Procedures']],
  ['ABP', 'ABP-Board', 'Pediatrics Board Certification Prep Coach', ['Growth and development', 'Preventive pediatrics', 'Infectious diseases', 'Cardiology', 'Neurology', 'Adolescent medicine']],
  ['ABOG', 'ABOG-Board', 'Obstetrics and Gynecology Board Prep Coach', ['Obstetrics', 'Gynecology', 'Reproductive endocrinology', 'Gynecologic oncology', 'Maternal-fetal medicine']],
  ['ABPN', 'ABPN-Board', 'Psychiatry and Neurology Board Prep Coach', ['Mood disorders', 'Psychotic disorders', 'Neuroanatomy', 'Epilepsy', 'Stroke', 'Child psychiatry']],
  ['ABFM', 'ABFM-Board', 'Family Medicine Board Certification Prep Coach', ['Ambulatory care', 'Preventive medicine', 'Chronic disease management', 'Women\'s health', 'Pediatrics in family medicine']],
  ['ABR', 'ABR-Board', 'Radiology Board Certification Prep Coach', ['Physics', 'Anatomy', 'Neuroradiology', 'Body imaging', 'Musculoskeletal', 'Pediatric radiology']],
  ['ABA', 'ABA-Board', 'Anesthesiology Board Certification Prep Coach', ['Pharmacology', 'Physiology', 'Airway management', 'Regional anesthesia', 'Critical care', 'Pain medicine']],
  ['ABOS', 'ABOS-Board', 'Orthopedic Surgery Board Prep Coach', ['Trauma', 'Sports medicine', 'Joint reconstruction', 'Spine', 'Hand surgery', 'Pediatric orthopedics']],
  ['ANCC', 'FNP-BC', 'Family Nurse Practitioner Board Certification Coach', ['Assessment', 'Diagnosis', 'Planning', 'Implementation', 'Evaluation', 'Professional role']],
  ['ANCC', 'AGACNP-BC', 'Adult-Gerontology Acute Care NP Certification Coach', ['Acute illness management', 'Procedures', 'Critical care', 'Pharmacology', 'Diagnostics']],
  ['AANP', 'FNP-C', 'Family Nurse Practitioner Certification Coach', ['Primary care', 'Chronic disease', 'Acute care', 'Health promotion', 'Pharmacotherapeutics']],
  ['PCCN', 'CCRN', 'Critical Care Registered Nurse Certification Coach', ['Cardiovascular', 'Pulmonary', 'Endocrine', 'Neurology', 'GI', 'Renal', 'Hematology', 'Multisystem']],
  ['BLS-ACLS', 'ACLS', 'Advanced Cardiovascular Life Support Certification Coach', ['Cardiac arrest algorithms', 'Bradycardia', 'Tachycardia', 'Stroke', 'Post-resuscitation care']],
  ['PALS', 'PALS', 'Pediatric Advanced Life Support Certification Coach', ['Pediatric assessment', 'Respiratory emergencies', 'Shock', 'Cardiac arrest in children', 'Post-resuscitation']],
  ['NREMT', 'EMT', 'Emergency Medical Technician Certification Coach', ['Airway', 'Assessment', 'Medical emergencies', 'Trauma', 'OB and pediatrics', 'Operations']],
  ['NREMT', 'Paramedic', 'Paramedic Certification Coach', ['Advanced airway', 'Cardiology', 'Pharmacology', 'Medical emergencies', 'Trauma', 'Operations']],
];

function certCategory(id, label, iconId, skillBank, roles) {
  return {
    id,
    label,
    iconId,
    businessCategory: true,
    skillBank,
    traitBank: certTraits,
    roles,
  };
}

const cloudSkillBank = [
  'Cloud Architecture', 'IAM', 'Networking', 'Security', 'Cost Optimization',
  'High Availability', 'Disaster Recovery', 'Infrastructure as Code', 'Containers',
  'Serverless', 'Observability', 'Compliance',
];

const securitySkillBank = [
  'Threat Modeling', 'Risk Assessment', 'Incident Response', 'Cryptography',
  'Identity Management', 'Vulnerability Management', 'Security Operations',
  'Governance', 'Penetration Testing', 'Forensics', 'Cloud Security', 'Compliance',
];

const financeSkillBank = [
  'Financial Reporting', 'Taxation', 'Audit', 'Risk Management', 'Portfolio Management',
  'Corporate Finance', 'Ethics', 'Regulation', 'Valuation', 'Investment Analysis',
  'Accounting Standards', 'Compliance',
];

/** @returns {object[]} */
export function certificationCategoryDefinitions() {
  return [
    certCategory('aws-certification-prep', 'AWS Certification Prep', 'cloud', cloudSkillBank, examsFromRows(AWS_EXAMS)),
    certCategory('azure-certification-prep', 'Microsoft Azure Certification Prep', 'cloud', cloudSkillBank, examsFromRows(AZURE_EXAMS)),
    certCategory('gcp-certification-prep', 'Google Cloud Certification Prep', 'cloud', cloudSkillBank, examsFromRows(GCP_EXAMS)),
    certCategory('multicloud-vendor-certification-prep', 'Multicloud & Vendor Certification Prep', 'cloud', cloudSkillBank, examsFromRows(MULTICLOUD_EXAMS)),
    certCategory('security-certification-prep', 'Cybersecurity Certification Prep', 'verified', securitySkillBank, examsFromRows(SECURITY_EXAMS)),
    certCategory('networking-certification-prep', 'Networking Certification Prep', 'lan', [
      'Routing', 'Switching', 'BGP', 'OSPF', 'VPN', 'Firewalls', 'Load Balancing',
      'SD-WAN', 'Wireless', 'Network Security', 'Automation', 'Troubleshooting',
    ], examsFromRows(NETWORKING_EXAMS)),
    certCategory('pm-agile-certification-prep', 'Project Management & Agile Certification Prep', 'groups', [
      'Agile', 'Scrum', 'Kanban', 'SAFe', 'Risk Management', 'Stakeholder Management',
      'Scheduling', 'Budgeting', 'Process Improvement', 'ITIL', 'PRINCE2', 'Business Analysis',
    ], examsFromRows(PM_AGILE_EXAMS)),
    certCategory('finance-accounting-certification-prep', 'Finance & Accounting Certification Prep', 'balance', financeSkillBank, examsFromRows(FINANCE_EXAMS)),
    certCategory('data-analytics-certification-prep', 'Data & Analytics Certification Prep', 'analytics', [
      'SQL', 'ETL', 'Data Modeling', 'Business Intelligence', 'Data Warehousing',
      'Spark', 'Machine Learning', 'Data Governance', 'Visualization', 'Python', 'R', 'Statistics',
    ], examsFromRows(DATA_ANALYTICS_EXAMS)),
    certCategory('hr-legal-professional-certification-prep', 'HR, Legal & Professional Certification Prep', 'gavel', [
      'Employment Law', 'Compensation', 'Talent Management', 'Organizational Development',
      'Legal Research', 'Bar Exam Prep', 'Ethics', 'Compliance', 'Audit', 'Engineering Licensure',
      'Architecture Licensure', 'Sustainability', 'Risk Management',
    ], examsFromRows(HR_LEGAL_EXAMS)),
    certCategory('medical-nursing-certification-prep', 'Medical & Nursing Board Certification Prep', 'local_hospital', [
      'Clinical Medicine', 'Pharmacology', 'Pathophysiology', 'Patient Safety',
      'Evidence-Based Practice', 'Diagnostics', 'Board Exam Strategy', 'Medical Ethics',
      'Nursing Practice', 'Acute Care', 'Primary Care', 'Emergency Medicine',
    ], examsFromRows(MEDICAL_NURSING_EXAMS)),
  ];
}
