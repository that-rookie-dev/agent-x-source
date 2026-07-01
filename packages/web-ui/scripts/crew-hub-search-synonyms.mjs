/**
 * Curated search jargon per category — NOT per crew member.
 *
 * Management model (do not edit generated category .ts files):
 * 1. AUTO (zero maintenance): skillBank, title, label, expertise → buildSearchText()
 * 2. CURATED (this file): domain jargon users say but titles omit — grow from telemetry
 * 3. QUERY (crew-auto-compose DOMAIN_HINTS): map user phrasing → search terms at runtime
 * 4. RUNTIME LLM (crew-keyword-expander): novel topics on empty match
 *
 * When to add entries here:
 * - User query failed with no-keyword-match AND phase-2 LLM was needed repeatedly
 * - Common lay terms for a sector (e.g. "black hole" for astronomy crews)
 *
 * Run `node scripts/generate-crew-hub.mjs` after edits — manifest revision auto-bumps.
 */

/** @type {Record<string, string[]>} */
export const CATEGORY_SEARCH_SYNONYMS = {
  // ─── Space & physical sciences ───────────────────────────────────────
  'space-science-astronomy': [
    'black hole', 'blackhole', 'black holes', 'event horizon', 'singularity',
    'cosmos', 'cosmology', 'galaxy', 'galaxies', 'nebula', 'supernova',
    'telescope', 'observatory', 'orbit', 'orbital', 'satellite', 'spacecraft',
    'nasa', 'esa', 'spacex', 'mars', 'moon', 'lunar', 'exoplanet', 'asteroid',
  ],
  'theoretical-physical-sciences': [
    'astrophysics', 'astronomy', 'black hole', 'blackhole', 'black holes',
    'quantum mechanics', 'quantum physics', 'relativity', 'general relativity',
    'particle physics', 'standard model', 'thermodynamics', 'electromagnetism',
    'wave function', 'dark matter', 'dark energy', 'string theory', 'plasma',
  ],
  'environmental-earth-sciences': [
    'climate change', 'global warming', 'carbon', 'greenhouse', 'ecosystem',
    'geology', 'seismology', 'earthquake', 'volcano', 'oceanography', 'weather',
  ],
  'chemistry-materials-science': [
    'organic chemistry', 'inorganic chemistry', 'polymer', 'catalyst',
    'molecule', 'compound', 'reaction', 'laboratory', 'periodic table',
  ],
  'biological-life-sciences': [
    'genetics', 'genomics', 'crispr', 'gene editing', 'dna', 'rna',
    'cell biology', 'microbiology', 'ecology', 'evolution', 'biodiversity',
    'neuroscience', 'immunology', 'virology', 'stem cell',
  ],

  // ─── Engineering & tech (examples — extend from telemetry) ───────────
  'machine-learning-ai': [
    'artificial intelligence', 'deep learning', 'neural network', 'llm',
    'large language model', 'chatbot', 'computer vision', 'nlp',
    'natural language processing', 'transformer', 'fine tuning', 'fine-tuning',
    'pytorch', 'tensorflow', 'hugging face', 'huggingface', 'langchain',
    'rag', 'retrieval augmented generation', 'embedding', 'embeddings',
    'vector database', 'vector db', 'pinecone', 'weaviate', 'milvus',
    'pgvector', 'chroma', 'sagemaker', 'vertex ai', 'mlflow', 'wandb',
    'weights and biases', 'gpu', 'cuda', 'scikit learn', 'scikit-learn',
    'xgboost', 'lightgbm', 'jupyter', 'notebook', 'reinforcement learning',
    'rlhf', 'lora', 'peft', 'inference', 'training', 'fine tune',
  ],
  'devops-cloud-sre': [
    'kubernetes', 'k8s', 'docker', 'ci cd', 'cicd', 'terraform', 'helm',
    'aws', 'azure', 'gcp', 'cloud native', 'site reliability',
    'argocd', 'argo cd', 'gitops', 'flux', 'ansible', 'pulumi',
    'cloudformation', 'prometheus', 'grafana', 'datadog', 'splunk',
    'jaeger', 'opentelemetry', 'otel', 'pagerduty', 'incident response',
    'on call', 'on-call', 'slo', 'sli', 'error budget', 'chaos engineering',
    'eks', 'gke', 'aks', 'fargate', 'lambda', 'cloud run', 'service mesh',
    'istio', 'linkerd', 'envoy', 'vault', 'consul', 'finops', 'cloud cost',
    'infrastructure as code', 'iac', 'container', 'containerization',
    'deployment', 'pipeline', 'release automation', 'blue green',
    'canary deploy', 'canary', 'runbook', 'postmortem',
  ],
  'security-compliance': [
    'cybersecurity', 'infosec', 'penetration test', 'pentest', 'vulnerability',
    'owasp', 'zero trust', 'siem', 'incident response', 'burp suite',
    'burpsuite', 'metasploit', 'nessus', 'nmap', 'wireshark', 'snort',
    'suricata', 'yara', 'falco', 'trivy', 'clair', 'sast', 'dast', 'sca',
    'sbom', 'supply chain security', 'mitre att&ck', 'mitre attack',
    'cve', 'cwe', 'threat modeling', 'threat model', 'red team',
    'blue team', 'purple team', 'exploit', 'exploitation', 'malware',
    'ransomware', 'phishing', 'soc 2', 'soc2', 'iso 27001', 'grc',
    'identity access management', 'iam', 'sso', 'single sign on',
    'mfa', 'multi factor authentication', 'oauth', 'oidc', 'saml',
    'kms', 'hsm', 'encryption', 'cryptography', 'tls', 'mtls',
  ],
  'backend-engineering': [
    'backend', 'back end', 'server side', 'api', 'rest api', 'restful',
    'graphql', 'grpc', 'microservices', 'microservice', 'monolith',
    'spring boot', 'springboot', 'nodejs', 'node.js', 'express', 'fastapi',
    'django', 'flask', 'rails', 'ruby on rails', 'dotnet', '.net', 'asp.net',
    'kafka', 'rabbitmq', 'redis', 'message queue', 'event driven',
    'event sourcing', 'cqrs', 'ddd', 'domain driven design', 'oauth2',
    'jwt', 'json web token', 'websocket', 'websockets', 'openapi', 'swagger',
    'elasticsearch', 'opensearch', 'postgres', 'postgresql', 'mysql',
    'mongodb', 'distributed systems', 'high availability', 'scalability',
    'latency', 'throughput', 'caching', 'rate limiting', 'idempotency',
  ],
  'frontend-engineering': [
    'frontend', 'front end', 'front-end', 'ui', 'user interface', 'web ui',
    'react', 'reactjs', 'react.js', 'vue', 'vuejs', 'vue.js', 'angular',
    'svelte', 'sveltekit', 'nextjs', 'next.js', 'nuxt', 'remix', 'astro',
    'typescript', 'ts', 'javascript', 'js', 'css', 'tailwind', 'tailwindcss',
    'sass', 'scss', 'webpack', 'vite', 'esbuild', 'rollup', 'jest', 'vitest',
    'cypress', 'playwright', 'storybook', 'redux', 'zustand', 'react query',
    'tanstack query', 'pwa', 'progressive web app', 'ssr', 'ssg', 'isr',
    'web components', 'wcag', 'aria', 'accessibility', 'a11y', 'core web vitals',
    'web performance', 'microfrontend', 'micro frontends', 'design system',
  ],
  'platform-fullstack': [
    'fullstack', 'full stack', 'full-stack', 'platform engineering',
    'platform engineer', 'developer experience', 'devex', 'dx', 'monorepo',
    'turborepo', 'nx', 'pnpm', 'internal tools', 'bff', 'backend for frontend',
    'api gateway', 'feature flag', 'feature flags', 'launchdarkly',
    'release engineering', 'release pipeline', 'graphql', 'apollo', 'relay',
    'trpc', 'sentry', 'datadog', 'opentelemetry', 'ci cd', 'cicd',
    'github actions', 'circleci', 'build tooling', 'developer platform',
  ],
  'mobile-embedded-iot': [
    'mobile', 'mobile app', 'ios', 'iphone', 'ipad', 'swift', 'swiftui',
    'objective c', 'objective-c', 'xcode', 'android', 'kotlin', 'jetpack compose',
    'android studio', 'react native', 'flutter', 'dart', 'expo', 'cross platform',
    'embedded', 'embedded systems', 'firmware', 'microcontroller', 'mcu',
    'rtos', 'free rtos', 'freertos', 'zephyr', 'arm', 'esp32', 'arduino',
    'raspberry pi', 'rpi', 'iot', 'internet of things', 'mqtt', 'coap',
    'bluetooth', 'ble', 'bluetooth low energy', 'zigbee', 'matter', 'thread',
    'lorawan', 'lora', 'edge computing', 'edge device', 'ota', 'over the air',
    'sensor', 'telemetry', 'wearable', 'wearables', 'automotive embedded',
    'aws iot', 'azure iot', 'google cloud iot', 'device fleet',
  ],
  'data-engineering-analytics': [
    'data engineering', 'data engineer', 'data pipeline', 'pipeline',
    'etl', 'elt', 'data warehouse', 'data warehousing', 'data lake',
    'lakehouse', 'sql', 'python', 'pandas', 'pyspark', 'spark', 'airflow',
    'dbt', 'data build tool', 'snowflake', 'bigquery', 'big query',
    'redshift', 'databricks', 'duckdb', 'duck db', 'polars', 'kafka',
    'flink', 'apache beam', 'beam', 'tableau', 'powerbi', 'power bi',
    'looker', 'looker studio', 'mode', 'hex', 'prefect', 'dagster',
    'trino', 'presto', 'data quality', 'data governance', 'data catalog',
    'datahub', 'amundsen', 'openlineage', 'airbyte', 'fivetran',
    'iceberg', 'delta lake', 'hudi', 'reverse etl', 'data activation',
    'analytics engineering', 'metrics layer', 'semantic layer',
  ],
  'quality-testing': [
    'qa', 'quality assurance', 'testing', 'test automation', 'automated testing',
    'unit test', 'unit testing', 'integration test', 'e2e', 'end to end test',
    'end-to-end', 'jest', 'vitest', 'mocha', 'chai', 'playwright', 'cypress',
    'selenium', 'puppeteer', 'junit', 'pytest', 'py test', 'testng',
    'k6', 'gatling', 'jmeter', 'locust', 'load testing', 'performance testing',
    'stress testing', 'appium', 'detox', 'espresso', 'xcuitest', 'cucumber',
    'bdd', 'behavior driven', 'postman', 'newman', 'restassured', 'pact',
    'contract testing', 'mutation testing', 'stryker', 'accessibility testing',
    'axe', 'lighthouse', 'testrail', 'zephyr', 'regression testing',
    'compatibility testing', 'chaos testing', 'reliability testing',
  ],
  'database-infrastructure': [
    'database', 'db', 'dba', 'database administrator', 'sql', 'nosql',
    'postgres', 'postgresql', 'mysql', 'mariadb', 'oracle', 'sql server',
    'mssql', 'mongodb', 'mongo', 'redis', 'memcached', 'cassandra',
    'dynamodb', 'dynamo db', 'cockroachdb', 'cockroach db', 'spanner',
    'aurora', 'sqlite', 'elasticsearch', 'opensearch', 'neo4j', 'graph database',
    'janusgraph', 'influxdb', 'timescaledb', 'timescale', 'clickhouse',
    'snowflake', 'bigquery', 'big query', 'redshift', 'duckdb', 'duck db',
    'vitess', 'pgbouncer', 'proxy sql', 'proxyql', 'patroni', 'pgvector',
    'hbase', 'replication', 'sharding', 'partitioning', 'high availability',
    'ha', 'backup', 'recovery', 'query optimization', 'query tuning',
    'execution plan', 'indexing', 'indexes', 'migration', 'schema design',
  ],
  'game-graphics-realtime': [
    'game dev', 'game development', 'game developer', 'gamedev', 'unity',
    'unity3d', 'unreal', 'unreal engine', 'ue5', 'ue4', 'godot', 'c#',
    'c++', 'cpp', 'rendering', 'renderer', 'shader', 'shaders', 'opengl',
    'vulkan', 'directx', 'dx12', 'metal', 'webgl', 'webgpu', 'hlsl', 'glsl',
    'shader graph', 'vfx', 'particle system', 'blender', 'maya', 'substance',
    'houdini', 'physx', 'havok', 'physics simulation', 'netcode', 'multiplayer',
    'photon', 'mirror', 'fishnet', 'steamworks', 'playfab', 'gamelift',
    'ecs', 'entity component system', 'dod', 'data oriented design',
    'vr', 'virtual reality', 'ar', 'augmented reality', 'xr', 'openxr',
    'webxr', 'meta quest', 'quest', 'hololens', 'realtime', 'real time',
    '60fps', 'frame rate', 'optimization', 'level design', 'procedural generation',
  ],
  'networking-systems': [
    'networking', 'network', 'network engineer', 'tcp ip', 'tcp/ip', 'dns',
    'bgp', 'ospf', 'eigrp', 'is-is', 'mpls', 'vxlan', 'sd-wan', 'sdwan',
    'cisco', 'juniper', 'arista', 'frr', 'bird', 'iptables', 'nftables',
    'pfsense', 'opnsense', 'wireguard', 'ipsec', 'ip sec', 'openvpn',
    'tailscale', 'envoy', 'haproxy', 'nginx', 'keepalived', 'vrrp',
    'anycast', 'coredns', 'powerdns', 'ebpf', 'ebpf', 'xdp', 'cilium',
    'tcpdump', 'wireshark', 'nmap', 'mtr', 'traceroute', 'ping', 'load balancer',
    'load balancing', 'edge network', 'cdn', 'wan', 'lan', 'vlan', 'subnet',
    'firewall', 'routing', 'switching', 'protocol', 'latency', 'packet loss',
  ],
  'regulatory-compliance-audit': [
    'compliance', 'audit', 'auditor', 'pci dss', 'pci-dss', 'hipaa',
    'gdpr', 'ccpa', 'cpra', 'soc 2', 'soc2', 'iso 27001', 'fedramp',
    'sox', 'nist', 'nist 800-53', 'nist csf', 'cis controls', 'glba',
    'ferpa', 'coppa', 'grc', 'drata', 'vanta', 'secureframe', 'one trust',
    'onetrust', 'auditboard', 'audit board', 'evidence collection',
    'control mapping', 'gap analysis', 'remediation', 'privacy',
    'data protection', 'security controls', 'trust services',
  ],

  // ─── Medical (lay terms → category) ────────────────────────────────
  'medical-cardiology-vascular': [
    'heart attack', 'cardiac', 'blood pressure', 'hypertension', 'arrhythmia',
    'cholesterol', 'stroke', 'cardiovascular', 'heart failure', 'afib',
    'atrial fibrillation', 'pacemaker', 'stent', 'angioplasty', 'ecg', 'ekg',
    'coronary artery', 'palpitations', 'echocardiogram', 'cardiomyopathy',
  ],
  'medical-oncology-hematology': [
    'cancer', 'tumor', 'chemotherapy', 'radiation therapy', 'leukemia',
    'lymphoma', 'oncology', 'chemo', 'biopsy', 'remission', 'metastasis',
    'carcinoma', 'melanoma', 'myeloma', 'anemia', 'blood disorder',
  ],
  'medical-pulmonology-critical-care': [
    'lung', 'pneumonia', 'copd', 'asthma', 'pulmonary', 'respiratory',
    'ventilator', 'oxygen', 'breathing', 'bronchitis', 'emphysema',
    'pulmonary fibrosis', 'cystic fibrosis', 'sleep apnea', 'ards',
  ],
  'medical-gastroenterology-hepatology': [
    'stomach', 'liver', 'digestive', 'ibd', 'crohn', 'ulcerative colitis',
    'gerd', 'acid reflux', 'heartburn', 'colonoscopy', 'endoscopy', 'hepatitis',
    'cirrhosis', 'fatty liver', 'celiac', 'ibs', 'gallbladder', 'pancreatitis',
  ],
  'medical-endocrinology-metabolism': [
    'diabetes', 'thyroid', 'hormone', 'insulin', 'glucose', 'blood sugar',
    'type 1 diabetes', 'type 2 diabetes', 'hypothyroid', 'hyperthyroid',
    'pcos', 'osteoporosis', 'adrenal', 'pituitary', 'cgm', 'a1c',
  ],
  'medical-neurology-neuroscience-clinical': [
    'brain', 'neurology', 'seizure', 'epilepsy', 'migraine', 'headache',
    'parkinson', 'multiple sclerosis', 'ms', 'alzheimer', 'dementia',
    'stroke', 'neuropathy', 'concussion', 'vertigo', 'als', 'botox',
  ],
  'medical-psychiatry-behavioral': [
    'depression', 'anxiety', 'mental health', 'psychiatry', 'bipolar',
    'ptsd', 'adhd', 'ocd', 'schizophrenia', 'addiction', 'substance use',
    'therapy', 'counseling', 'antidepressant', 'ssri', 'mood', 'trauma',
  ],

  // ─── Certification prep (exam codes & vendor jargon) ────────────────
  'aws-certification-prep': [
    'aws certification', 'aws cert', 'aws exam', 'aws certified', 'amazon web services',
    'saa-c03', 'saa c03', 'clf-c02', 'dva-c02', 'soa-c03', 'dea-c01', 'mla-c01',
    'dop-c02', 'sap-c02', 'scs-c02', 'ans-c01', 'dbs-c01', 'das-c01', 'aif-c01',
    'solutions architect', 'cloud practitioner', 'developer associate',
    'sysops', 'devops professional', 'security specialty', 'networking specialty',
  ],
  'azure-certification-prep': [
    'azure certification', 'azure cert', 'azure exam', 'microsoft azure',
    'az-900', 'az 900', 'az-104', 'az-204', 'az-305', 'az-400', 'az-500',
    'az-700', 'az-800', 'az-801', 'ai-900', 'dp-900', 'sc-900', 'sc-200',
    'sc-300', 'sc-400', 'sc-100', 'dp-203', 'dp-300', 'dp-600', 'dp-700',
    'ai-102', 'azure fundamentals', 'azure administrator', 'azure developer',
    'azure architect', 'azure devops', 'azure security',
  ],
  'gcp-certification-prep': [
    'gcp certification', 'gcp cert', 'google cloud certification', 'google cloud exam',
    'cloud digital leader', 'cdl', 'associate cloud engineer', 'ace',
    'professional cloud architect', 'pca', 'professional cloud developer', 'pcd',
    'professional data engineer', 'pde', 'professional cloud network engineer', 'pcne',
    'professional cloud security engineer', 'pcse', 'professional cloud devops engineer', 'pcdo',
    'professional machine learning engineer', 'pmle', 'bigquery', 'vertex ai', 'gke',
  ],
  'security-certification-prep': [
    'cissp', 'ccsp', 'sscp', 'cism', 'cisa', 'crisc', 'security+', 'security plus',
    'cysa+', 'pentest+', 'pen test+', 'casp+', 'ceh', 'certified ethical hacker',
    'oscp', 'oswe', 'gsec', 'gpen', 'gwapt', 'gxpn', 'ccsk', 'gcih', 'gcfe',
    'isc2', 'isaca', 'comptia', 'ec-council', 'offensive security', 'giac', 'sans',
  ],
  'networking-certification-prep': [
    'ccna', 'ccnp', 'ccie', 'cisco certification', 'jncia', 'jncis', 'juniper',
    'palo alto', 'pcnsa', 'pcnse', 'fortinet', 'nse4', 'network+', 'server+',
    'f5', 'big-ip', 'ltm', 'aruba', 'acma', 'cloudflare', 'aviatrix', 'devnet',
  ],
  'pm-agile-certification-prep': [
    'pmp', 'capm', 'pmi-acp', 'pmi-pba', 'pgmp', 'csm', 'cspo', 'psm-i', 'psm-ii',
    'pspo-i', 'safe agilist', 'safe scrum master', 'icp-acc', 'itil 4', 'prince2',
    'project management professional', 'scrum master', 'product owner', 'agile',
    'scrum', 'kanban', 'safe', 'scaled agile', 'iiba', 'ecba', 'ccba', 'cbap',
    'lean six sigma', 'green belt', 'black belt', 'kmp-i',
  ],
  'finance-accounting-certification-prep': [
    'cpa', 'cfa', 'cma', 'acca', 'frm', 'cfp', 'enrolled agent', 'ea', 'series 7',
    'series 63', 'series 65', 'series 66', 'caia', 'cima', 'soa', 'cpcu', 'cams',
    'certified public accountant', 'chartered financial analyst', 'anti money laundering',
    'aml', 'kyc', 'finra', 'gaap', 'ifrs',
  ],
  'data-analytics-certification-prep': [
    'databricks', 'snowflake', 'snowpro', 'power bi', 'pl-300', 'tableau',
    'mongodb', 'oracle sql', 'oca', 'ocp', 'postgresql', 'pgca', 'redis',
    'cloudera', 'cca', 'informatica', 'talend', 'dbt', 'alteryx', 'sas',
    'google data analytics', 'data engineer associate', 'lakehouse',
  ],
  'multicloud-vendor-certification-prep': [
    'oci', 'oracle cloud', 'ibm cloud', 'alibaba cloud', 'vmware', 'vcp-dcv',
    'vcp-nv', 'rhcsa', 'rhce', 'red hat', 'ansible', 'salesforce', 'adm-201',
    'platform developer', 'servicenow', 'csa', 'sap', 's/4hana', 'kubernetes',
    'kcna', 'cka', 'ckad', 'cks', 'terraform associate', 'vault associate',
    'docker', 'dca', 'lfcs', 'linux foundation',
  ],
  'medical-nursing-certification-prep': [
    'usmle', 'step 1', 'step 2 ck', 'step 3', 'nclex', 'nclex-rn', 'nclex-pn',
    'abim', 'abem', 'abp', 'abog', 'abpn', 'abfm', 'abr', 'aba', 'abos',
    'fnp', 'agacnp', 'ccrn', 'acls', 'pals', 'emt', 'paramedic', 'board prep',
    'medical board', 'nursing license', 'nursing board',
  ],
};

/**
 * Cross-category topic bridges — applied to searchText for every crew in listed categories.
 * Use when a user topic spans a known category set.
 *
 * @type {Array<{ tags: string[]; categories: string[] }>}
 */
export const TOPIC_CATEGORY_BRIDGE = [
  {
    tags: ['space exploration', 'space science', 'astronaut', 'rocket', 'launch vehicle'],
    categories: ['space-science-astronomy', 'applied-engineering-sciences'],
  },
];
