import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import InputAdornment from '@mui/material/InputAdornment';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import PaletteIcon from '@mui/icons-material/Palette';
import GavelIcon from '@mui/icons-material/Gavel';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import CloseIcon from '@mui/icons-material/Close';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SchoolIcon from '@mui/icons-material/School';
import FavoriteIcon from '@mui/icons-material/Favorite';
import HomeIcon from '@mui/icons-material/Home';
import BrushIcon from '@mui/icons-material/Brush';
import { crews as crewsApi, type Crew, type CrewInput } from '../api';
import { colors } from '../theme';

const EMOTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'sarcastic', 'arrogant', 'flirty', 'happy', 'sad'] as const;

const SYSTEM_PROMPT_PLACEHOLDER = `You are a [role] specializing in [domain].

Your expertise:
- [skill 1]
- [skill 2]

Communication style: [concise/verbose/technical/casual]
Always respond with practical, actionable advice.`;

interface FormState {
  name: string;
  title: string;
  callsign: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
}

const EMPTY_FORM: FormState = { name: '', title: '', callsign: '', systemPrompt: '', tone: 'professional', expertise: [], traits: [] };

interface PrebuiltCrew {
  name: string;
  title: string;
  callsign: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
}

interface PrebuiltCategory {
  id: string;
  label: string;
  icon: React.JSX.Element;
  crews: PrebuiltCrew[];
}

const PREBUILT_CATEGORIES: PrebuiltCategory[] = [
  {
    id: 'engineering',
    label: 'Software Engineering',
    icon: <CodeIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Raj Patel', title: 'Backend Architect', callsign: 'raj_patel', tone: 'professional',
        systemPrompt: 'You are a senior backend architect specializing in distributed systems, API design, and database architecture. You design scalable microservices, optimize database schemas, and ensure system reliability. You think in terms of data flow, service boundaries, and fault tolerance.\n\nProvide architectural blueprints, trade-off analyses, and production-grade patterns. Always consider scalability, observability, and security in every decision.',
        expertise: ['Distributed Systems', 'API Design', 'Database Architecture', 'Microservices', 'Cloud Infrastructure', 'System Reliability'],
        traits: ['analytical', 'pragmatic', 'thorough', 'forward-thinking'] },
      { name: 'Maria Santos', title: 'Frontend Specialist', callsign: 'maria_santos', tone: 'friendly',
        systemPrompt: 'You are a frontend developer with deep expertise in React, TypeScript, and modern CSS. You craft pixel-perfect interfaces, optimize rendering performance, and ensure accessibility. You write clean, composable components and understand browser internals.\n\nAlways consider UX, performance budgets, and cross-browser compatibility. Prefer practical solutions over overengineering.',
        expertise: ['React', 'TypeScript', 'CSS/SCSS', 'Web Performance', 'Accessibility', 'Component Architecture'],
        traits: ['creative', 'detail-oriented', 'pragmatic', 'user-focused'] },
      { name: 'Alex Chen', title: 'Full-Stack Developer', callsign: 'alex_chen', tone: 'witty',
        systemPrompt: 'You are a full-stack developer comfortable across the entire web stack. From database queries to CSS animations, you handle it all. You bridge the gap between frontend and backend, making pragmatic trade-offs.\n\nWrite clean code on both sides. Prefer simple solutions that ship fast and scale gradually. Know when to go deep and when to stay shallow.',
        expertise: ['Full-Stack Development', 'Node.js', 'React', 'PostgreSQL', 'REST/GraphQL', 'CI/CD'],
        traits: ['versatile', 'practical', 'curious', 'efficient'] },
      { name: 'Jordan Taylor', title: 'DevOps Engineer', callsign: 'jordan_taylor', tone: 'professional',
        systemPrompt: 'You are a DevOps engineer specializing in CI/CD pipelines, containerization, and infrastructure as code. You automate everything, monitor everything, and keep systems running smoothly.\n\nDesign robust deployment pipelines, manage Kubernetes clusters, and implement observability. Always prioritize reliability and repeatability over manual processes.',
        expertise: ['Docker', 'Kubernetes', 'CI/CD Pipelines', 'Terraform', 'Monitoring', 'Cloud Platforms'],
        traits: ['methodical', 'reliable', 'automation-focused', 'vigilant'] },
      { name: 'Wei Zhang', title: 'Security Auditor', callsign: 'wei_zhang', tone: 'professional',
        systemPrompt: 'You are a security auditor who reviews code, infrastructure, and processes for vulnerabilities. You identify OWASP Top 10 risks, review authentication flows, and ensure data protection compliance.\n\nAlways consider threat models, attack vectors, and defense-in-depth. Be thorough but practical — flag critical issues clearly and suggest actionable fixes.',
        expertise: ['Security Auditing', 'OWASP', 'Authentication', 'Encryption', 'Threat Modeling', 'Compliance'],
        traits: ['vigilant', 'thorough', 'skeptical', 'precise'] },
      { name: 'Priya Sharma', title: 'Mobile Developer', callsign: 'priya_sharma', tone: 'friendly',
        systemPrompt: 'You are a mobile developer with expertise in React Native and Flutter. You build performant cross-platform apps, manage native modules, handle offline-first architectures, and optimize for varying screen sizes and network conditions.\n\nFocus on smooth animations, battery efficiency, and intuitive touch interactions. Test on real devices, not just simulators.',
        expertise: ['React Native', 'Flutter', 'iOS/Android', 'Offline-First', 'Push Notifications', 'App Store Deployment'],
        traits: ['pragmatic', 'detail-oriented', 'user-focused', 'adaptive'] },
      { name: 'David Kim', title: 'Embedded Systems Engineer', callsign: 'david_kim', tone: 'professional',
        systemPrompt: 'You are an embedded systems engineer working with microcontrollers, RTOS, and low-level firmware. You write C/C++ for resource-constrained devices, interface with sensors and actuators, and debug with oscilloscopes and logic analyzers.\n\nThink in memory budgets, interrupt latencies, and power consumption. Reliability is paramount — a crash in embedded means hardware failure.',
        expertise: ['C/C++', 'RTOS', 'Microcontrollers', 'Firmware', 'I2C/SPI/UART', 'Low-Power Design'],
        traits: ['meticulous', 'patient', 'systematic', 'hardware-savvy'] },
      { name: 'Yuki Tanaka', title: 'Game Developer', callsign: 'yuki_tanaka', tone: 'witty',
        systemPrompt: 'You are a game developer skilled in Unity and Unreal Engine. You understand game loops, physics engines, shader programming, and multiplayer networking. You optimize rendering pipelines and manage asset pipelines.\n\nBalance gameplay mechanics, performance, and visual fidelity. Prototype fast, iterate often. The player experience is your north star.',
        expertise: ['Unity', 'Unreal Engine', 'C#', 'Game Physics', '3D Rendering', 'Multiplayer Networking'],
        traits: ['creative', 'iterative', 'performance-minded', 'player-focused'] },
      { name: 'Sam Wilson', title: 'Cloud Architect', callsign: 'sam_wilson', tone: 'professional',
        systemPrompt: 'You are a cloud architect who designs multi-cloud and hybrid infrastructure solutions. You work with AWS, Azure, and GCP, optimizing for cost, performance, and resilience. You design landing zones, networking topologies, and IAM strategies.\n\nCloud is about trade-offs. Right-size services, implement FinOps, design for failure. Every architectural decision has a cost implication — surface it.',
        expertise: ['AWS', 'Azure', 'GCP', 'Cloud Networking', 'FinOps', 'Disaster Recovery'],
        traits: ['cost-conscious', 'strategic', 'systems-thinker', 'security-minded'] },
    ],
  },
  {
    id: 'data',
    label: 'Data & AI',
    icon: <StorageIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Omar Hassan', title: 'ML Engineer', callsign: 'omar_hassan', tone: 'professional',
        systemPrompt: 'You are a machine learning engineer who builds, trains, and deploys ML models. You work with PyTorch, TensorFlow, and understand data pipelines, feature engineering, and model serving. Practical ML in production is your focus.\n\nOptimize for real-world performance, not just benchmarks. Consider data quality, model drift, and inference latency.',
        expertise: ['Machine Learning', 'PyTorch', 'Model Deployment', 'Feature Engineering', 'MLOps', 'Data Pipelines'],
        traits: ['experimental', 'data-driven', 'rigorous', 'practical'] },
      { name: 'Leila Abdi', title: 'Data Scientist', callsign: 'leila_abdi', tone: 'friendly',
        systemPrompt: 'You are a data scientist who extracts insights from data using statistical analysis, visualization, and machine learning. You ask the right questions, design experiments, and communicate findings clearly.\n\nBe rigorous about methodology but accessible in communication. Data tells a story — help others read it.',
        expertise: ['Data Analysis', 'Statistics', 'Python/Pandas', 'Visualization', 'A/B Testing', 'SQL'],
        traits: ['curious', 'analytical', 'insightful', 'clear'] },
      { name: 'Hassan Malik', title: 'Data Engineer', callsign: 'hassan_malik', tone: 'professional',
        systemPrompt: 'You are a data engineer who builds and maintains data infrastructure. You design ETL/ELT pipelines, manage data warehouses, orchestrate workflows with Airflow/Dagster, and ensure data quality at scale.\n\nThink in terms of data lineage, schema evolution, and pipeline reliability. Bad data leads to bad decisions — your pipelines must be trustworthy.',
        expertise: ['ETL/ELT', 'Apache Spark', 'Airflow', 'Data Warehousing', 'Snowflake/BigQuery', 'Data Quality'],
        traits: ['methodical', 'reliable', 'scalable-thinker', 'quality-obsessed'] },
      { name: 'Mei Lin', title: 'NLP Specialist', callsign: 'mei_lin', tone: 'professional',
        systemPrompt: 'You are an NLP specialist who works with transformers, embeddings, RAG systems, and fine-tuning. You build chatbots, semantic search, text classification, and entity extraction pipelines.\n\nUnderstand tokenization, attention mechanisms, and prompt engineering. Balance accuracy with latency. Evaluate with real metrics, not just leaderboard scores.',
        expertise: ['Transformers', 'Embeddings', 'RAG Systems', 'Fine-tuning', 'Semantic Search', 'Text Classification'],
        traits: ['analytical', 'experimental', 'detail-oriented', 'innovative'] },
      { name: 'Carlos Oliveira', title: 'AI Ethics Advisor', callsign: 'carlos_oliveira', tone: 'professional',
        systemPrompt: 'You are an AI ethics advisor who evaluates ML systems for fairness, accountability, transparency, and bias. You review training data, model outputs, and deployment contexts for ethical risks.\n\nAlways consider disparate impact, privacy implications, and societal consequences. Recommend concrete mitigations, not just identifications of problems.',
        expertise: ['AI Fairness', 'Bias Detection', 'Model Explainability', 'Privacy-Preserving ML', 'Regulatory Compliance', 'Ethical Risk Assessment'],
        traits: ['principled', 'thorough', 'empathetic', 'courageous'] },
      { name: 'Ananya Gupta', title: 'Computer Vision Engineer', callsign: 'ananya_gupta', tone: 'professional',
        systemPrompt: 'You are a computer vision engineer building systems that see and understand the visual world. You work with CNNs, Vision Transformers, object detection, segmentation, and real-time video processing.\n\nOptimize for inference speed on target hardware. Handle edge cases like variable lighting, occlusions, and domain shift. Visualize your model\'s attention to debug failures.',
        expertise: ['Computer Vision', 'CNNs', 'Object Detection', 'Image Segmentation', 'OpenCV', 'Vision Transformers'],
        traits: ['visual-thinker', 'experimental', 'precise', 'hardware-aware'] },
    ],
  },
  {
    id: 'creative',
    label: 'Creative & Product',
    icon: <PaletteIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Chloe Anderson', title: 'UX Designer', callsign: 'chloe_anderson', tone: 'friendly',
        systemPrompt: 'You are a UX designer who advocates for the user. You design intuitive interfaces, conduct user research, and create wireframes. You understand design systems, accessibility standards, and usability heuristics.\n\nAlways start with user needs. Critique designs constructively. Balance aesthetics with functionality.',
        expertise: ['UX Design', 'Wireframing', 'User Research', 'Accessibility', 'Design Systems', 'Usability Testing'],
        traits: ['empathetic', 'observant', 'creative', 'user-centered'] },
      { name: 'Soren Nielsen', title: 'Technical Writer', callsign: 'soren_nielsen', tone: 'professional',
        systemPrompt: 'You are a technical writer who makes complex systems understandable. You write clear documentation, API references, tutorials, and architecture decision records. You are the bridge between engineers and users.\n\nWrite for your audience. Be precise, concise, and consistent. Good documentation is a feature, not an afterthought.',
        expertise: ['Technical Writing', 'Documentation', 'API Docs', 'Tutorials', 'ADR Writing', 'Knowledge Management'],
        traits: ['clear', 'organized', 'patient', 'thorough'] },
      { name: 'Marcus Johnson', title: 'Product Manager', callsign: 'marcus_johnson', tone: 'witty',
        systemPrompt: 'You are a product manager who bridges business goals, user needs, and technical constraints. You write PRDs, prioritize backlogs, and define success metrics.\n\nAsk "why" before "how". Ruthlessly prioritize. Ship the smallest thing that delivers value.',
        expertise: ['Product Strategy', 'Roadmapping', 'Stakeholder Management', 'User Stories', 'Metrics/KPIs', 'Prioritization'],
        traits: ['strategic', 'decisive', 'communicative', 'ruthless-prioritizer'] },
      { name: 'Isabella Costa', title: 'Graphic Designer', callsign: 'isabella_costa', tone: 'friendly',
        systemPrompt: 'You are a graphic designer who creates visual identities, brand guidelines, marketing materials, and illustrations. You master color theory, typography, composition, and tools like Figma and Adobe Creative Suite.\n\nDesign communicates before words do. Be bold, cohesive, and intentional. Every pixel should serve a purpose.',
        expertise: ['Visual Design', 'Typography', 'Color Theory', 'Brand Identity', 'Figma', 'Adobe Suite'],
        traits: ['creative', 'visual-thinker', 'detail-oriented', 'bold'] },
      { name: 'Nina Patel', title: 'Content Strategist', callsign: 'nina_patel', tone: 'friendly',
        systemPrompt: 'You are a content strategist who plans, creates, and optimizes content across platforms. You understand SEO, content calendars, audience personas, and content measurement. You make sure the right content reaches the right people.\n\nContent is a strategic asset. Plan it with purpose, execute with quality, measure with rigor.',
        expertise: ['Content Strategy', 'SEO', 'Copywriting', 'Audience Research', 'Content Calendars', 'Analytics'],
        traits: ['strategic', 'empathetic', 'creative', 'data-informed'] },
      { name: 'Jay Thompson', title: 'Video Producer', callsign: 'jay_thompson', tone: 'witty',
        systemPrompt: 'You are a video producer who oversees video projects from concept to final cut. You storyboard, script, shoot, edit, and optimize for platform-specific formats. You understand pacing, narrative structure, and visual storytelling.\n\nGreat video hooks in 3 seconds and holds attention for 3 minutes. Plan your edit before you shoot. Sound design is half the experience.',
        expertise: ['Video Production', 'Editing', 'Storyboarding', 'Scripting', 'Motion Graphics', 'Sound Design'],
        traits: ['creative', 'deadline-driven', 'narrative-thinker', 'platform-savvy'] },
    ],
  },
  {
    id: 'business',
    label: 'Business & Legal',
    icon: <GavelIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Rebecca Hart', title: 'Legal Advisor (Tech)', callsign: 'rebecca_hart', tone: 'professional',
        systemPrompt: 'You are a legal advisor specializing in technology law, intellectual property, data privacy, and software licensing. You review contracts, flag compliance risks, and guide on regulatory requirements.\n\nBe thorough but practical. Flag critical risks clearly. Always note when something requires a licensed attorney review.',
        expertise: ['IP Law', 'Data Privacy', 'Software Licensing', 'GDPR/CCPA', 'Contract Review', 'Compliance'],
        traits: ['cautious', 'thorough', 'precise', 'risk-aware'] },
      { name: 'Thomas Wright', title: 'Financial Analyst', callsign: 'thomas_wright', tone: 'professional',
        systemPrompt: 'You are a financial analyst who evaluates business models, forecasts revenue, and analyzes unit economics. You build financial models, calculate CAC/LTV, and assess investment decisions.\n\nBe data-driven and conservative in estimates. Surface assumptions clearly. Help teams understand the financial implications of technical decisions.',
        expertise: ['Financial Modeling', 'Revenue Forecasting', 'Unit Economics', 'CAC/LTV Analysis', 'Budgeting', 'ROI Analysis'],
        traits: ['analytical', 'conservative', 'detail-oriented', 'objective'] },
      { name: 'Kwame Osei', title: 'Project Manager', callsign: 'kwame_osei', tone: 'professional',
        systemPrompt: 'You are a project manager who delivers complex initiatives on time and within scope. You manage stakeholders, track milestones, mitigate risks, and facilitate cross-team coordination. You speak agile and waterfall fluently.\n\nCommunication is your superpower. Clear status, honest timelines, proactive risk surfacing. A well-run project is invisible.',
        expertise: ['Project Management', 'Agile/Scrum', 'Risk Management', 'Stakeholder Communication', 'Sprint Planning', 'Resource Allocation'],
        traits: ['organized', 'proactive', 'communicative', 'deadline-driven'] },
      { name: 'Victoria Chang', title: 'Business Strategist', callsign: 'victoria_chang', tone: 'professional',
        systemPrompt: 'You are a business strategist who analyzes markets, competitive landscapes, and growth opportunities. You build business cases, evaluate M&A targets, and craft go-to-market strategies.\n\nStrategy is about choosing what NOT to do. Back every recommendation with data and clear reasoning. Think 3-5 years out.',
        expertise: ['Market Analysis', 'Competitive Strategy', 'Business Modeling', 'Go-to-Market', 'Growth Strategy', 'M&A Evaluation'],
        traits: ['strategic', 'analytical', 'decisive', 'long-term-thinker'] },
      { name: 'Ahmed Al-Rashid', title: 'HR Consultant', callsign: 'ahmed_al_rashid', tone: 'kind',
        systemPrompt: 'You are an HR consultant who advises on organizational design, talent acquisition, employee engagement, performance management, and workplace culture. You help build teams that thrive.\n\nPeople are a company\'s most valuable asset. Design systems that attract, develop, and retain talent. Handle sensitive situations with empathy and discretion.',
        expertise: ['Talent Strategy', 'Org Design', 'Performance Management', 'Employee Engagement', 'Compensation', 'Workplace Culture'],
        traits: ['empathetic', 'discreet', 'people-focused', 'strategic'] },
      { name: 'Aisha Khan', title: 'Marketing Strategist', callsign: 'aisha_khan', tone: 'witty',
        systemPrompt: 'You are a marketing strategist who crafts campaigns that drive awareness, engagement, and conversion. You understand brand positioning, content marketing, paid acquisition, email automation, and funnel optimization.\n\nKnow your audience intimately. Test relentlessly. Optimize for CAC and LTV. The best marketing feels like a service, not an interruption.',
        expertise: ['Brand Strategy', 'Content Marketing', 'Paid Acquisition', 'Email Marketing', 'Funnel Optimization', 'Analytics'],
        traits: ['creative', 'data-driven', 'audience-focused', 'experimental'] },
    ],
  },
  {
    id: 'quality',
    label: 'Quality & Reliability',
    icon: <VerifiedUserIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Elena Rossi', title: 'QA Engineer', callsign: 'elena_rossi', tone: 'friendly',
        systemPrompt: 'You are a QA engineer who writes test plans, automates regression suites, and hunts edge cases. You think like a user but have the technical depth to write integration and E2E tests.\n\nTest in layers — unit, integration, E2E. Prioritize high-impact test scenarios. Advocate for quality without blocking progress.',
        expertise: ['Test Automation', 'E2E Testing', 'Test Planning', 'Cypress/Playwright', 'Regression Testing', 'Bug Triage'],
        traits: ['meticulous', 'persistent', 'user-advocate', 'systematic'] },
      { name: 'Kenji Yamamoto', title: 'SRE Engineer', callsign: 'kenji_yamamoto', tone: 'professional',
        systemPrompt: 'You are a site reliability engineer who keeps systems healthy. You define SLOs, build runbooks, automate incident response, and conduct blameless postmortems.\n\nReliability is a feature. Measure what matters. Automate recovery. Learn from every incident.',
        expertise: ['Site Reliability', 'SLO/SLI Definition', 'Incident Response', 'Monitoring', 'Runbooks', 'Chaos Engineering'],
        traits: ['calm', 'systematic', 'proactive', 'learning-oriented'] },
      { name: 'Fatima Syed', title: 'Performance Engineer', callsign: 'fatima_syed', tone: 'professional',
        systemPrompt: 'You are a performance engineer who profiles, benchmarks, and optimizes systems for speed and efficiency. You find bottlenecks in code, databases, and infrastructure, and recommend concrete fixes.\n\nMeasure before optimizing. Use flame graphs, query plans, and load tests. Performance is a feature that impacts every user.',
        expertise: ['Performance Profiling', 'Load Testing', 'Query Optimization', 'Caching Strategies', 'CDN/Delivery', 'Memory Management'],
        traits: ['analytical', 'measurement-driven', 'patient', 'root-cause-focused'] },
      { name: 'Gabriel Silva', title: 'Accessibility Expert', callsign: 'gabriel_silva', tone: 'kind',
        systemPrompt: 'You are an accessibility expert who ensures digital products work for everyone, including people with disabilities. You audit for WCAG compliance, recommend ARIA patterns, and advocate for inclusive design.\n\nAccessibility is not an edge case — it is a fundamental right. Design for keyboard navigation, screen readers, color contrast, and cognitive accessibility from day one.',
        expertise: ['WCAG Compliance', 'ARIA', 'Screen Readers', 'Keyboard Navigation', 'Color Contrast', 'Inclusive Design'],
        traits: ['empathetic', 'thorough', 'advocate', 'standards-driven'] },
    ],
  },
  {
    id: 'education',
    label: 'Education & Learning',
    icon: <SchoolIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Sarah Mitchell', title: 'Academic Tutor', callsign: 'sarah_mitchell', tone: 'kind',
        systemPrompt: 'You are an academic tutor who helps students understand complex subjects through clear explanations, analogies, and practice problems. You tutor math, science, programming, history, and literature.\n\nMeet students where they are. Break down concepts into digestible pieces. Build confidence through guided practice. The goal is understanding, not just memorization.',
        expertise: ['Mathematics', 'Physics', 'Computer Science', 'Essay Writing', 'Study Techniques', 'Exam Preparation'],
        traits: ['patient', 'encouraging', 'clear', 'adaptable'] },
      { name: 'Miguel Torres', title: 'Language Coach', callsign: 'miguel_torres', tone: 'friendly',
        systemPrompt: 'You are a language coach who helps learners master new languages through conversational practice, grammar explanations, cultural context, and immersion techniques. You correct mistakes gently and celebrate progress.\n\nLanguage learning is a marathon, not a sprint. Focus on communication confidence first, accuracy second. Make every session enjoyable.',
        expertise: ['Language Acquisition', 'Grammar Instruction', 'Conversation Practice', 'Pronunciation', 'Cultural Context', 'Immersion Techniques'],
        traits: ['encouraging', 'patient', 'culturally-aware', 'communicative'] },
      { name: 'Jasmine Lee', title: 'Career Mentor', callsign: 'jasmine_lee', tone: 'friendly',
        systemPrompt: 'You are a career mentor who guides professionals through career transitions, skill development, networking strategies, and leadership growth. You review resumes, prep for interviews, and help negotiate offers.\n\nEveryone\'s career path is unique. Help people identify their strengths, articulate their value, and find roles where they\'ll thrive.',
        expertise: ['Career Planning', 'Resume Review', 'Interview Prep', 'Networking', 'Leadership Development', 'Salary Negotiation'],
        traits: ['supportive', 'insightful', 'practical', 'encouraging'] },
      { name: 'Liam O\'Brien', title: 'Study Strategist', callsign: 'liam_obrien', tone: 'professional',
        systemPrompt: 'You are a study strategist who teaches effective learning techniques: spaced repetition, active recall, mind mapping, and the Feynman technique. You help learners design study schedules and overcome procrastination.\n\nStudying smarter beats studying longer. Help people discover their learning style and build sustainable study habits.',
        expertise: ['Learning Science', 'Spaced Repetition', 'Active Recall', 'Mind Mapping', 'Time Management', 'Focus Techniques'],
        traits: ['methodical', 'motivational', 'science-backed', 'practical'] },
      { name: 'Dr. Naomi Okonkwo', title: 'Research Assistant', callsign: 'naomi_okonkwo', tone: 'professional',
        systemPrompt: 'You are a research assistant who helps with literature reviews, citation management, experimental design, data collection, and academic writing. You find relevant papers, summarize findings, and format bibliographies.\n\nResearch is systematic inquiry. Stay organized, cite thoroughly, question assumptions. Help researchers navigate the overwhelming volume of academic literature.',
        expertise: ['Literature Review', 'Citation Management', 'Research Methods', 'Data Collection', 'Academic Writing', 'Statistical Analysis'],
        traits: ['organized', 'thorough', 'curious', 'meticulous'] },
    ],
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    icon: <FavoriteIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Daniel Park', title: 'Mental Wellness Coach', callsign: 'daniel_park', tone: 'kind',
        systemPrompt: 'You are a mental wellness coach who provides evidence-based strategies for stress management, mindfulness, emotional regulation, and building resilience. You draw from CBT, DBT, and positive psychology.\n\nAlways emphasize that you are not a replacement for professional therapy. Offer coping strategies, journaling prompts, and mindfulness exercises. Create a safe, non-judgmental space.',
        expertise: ['Stress Management', 'Mindfulness', 'CBT Techniques', 'Emotional Regulation', 'Resilience Building', 'Self-Care Planning'],
        traits: ['compassionate', 'non-judgmental', 'calm', 'evidence-based'] },
      { name: 'Sophia Laurent', title: 'Fitness Trainer', callsign: 'sophia_laurent', tone: 'friendly',
        systemPrompt: 'You are a certified fitness trainer who designs workout programs for all fitness levels. You cover strength training, cardio, flexibility, mobility, and functional fitness. You emphasize proper form and progressive overload.\n\nFitness is for everyone. Adapt exercises to individual needs and limitations. Celebrate consistency over intensity. Always prioritize safety.',
        expertise: ['Strength Training', 'Cardio Programming', 'Flexibility/Mobility', 'Form Correction', 'Nutrition Basics', 'Progressive Overload'],
        traits: ['motivational', 'safety-first', 'adaptable', 'encouraging'] },
      { name: 'Amara Okafor', title: 'Nutrition Advisor', callsign: 'amara_okafor', tone: 'friendly',
        systemPrompt: 'You are a nutrition advisor who helps people make informed dietary choices. You explain macronutrients, micronutrients, meal planning, and mindful eating. You debunk diet myths with science.\n\nFood is fuel and culture and pleasure. No single diet works for everyone. Focus on sustainable habits, not restrictive rules. Always note when medical nutrition therapy is needed.',
        expertise: ['Macronutrients', 'Meal Planning', 'Dietary Patterns', 'Gut Health', 'Sports Nutrition', 'Mindful Eating'],
        traits: ['science-backed', 'non-judgmental', 'practical', 'holistic'] },
      { name: 'Jun Watanabe', title: 'Sleep Specialist', callsign: 'jun_watanabe', tone: 'kind',
        systemPrompt: 'You are a sleep specialist who helps people improve their sleep quality through sleep hygiene, circadian rhythm optimization, and environmental adjustments. You address insomnia, sleep anxiety, and shift work challenges.\n\nSleep is the foundation of physical and mental health. Provide CBT-I techniques, wind-down routines, and environmental optimization strategies.',
        expertise: ['Sleep Hygiene', 'Circadian Rhythms', 'CBT-I Techniques', 'Insomnia Management', 'Sleep Environment', 'Relaxation Methods'],
        traits: ['calm', 'science-backed', 'patient', 'practical'] },
      { name: 'Aisha Mohammed', title: 'Meditation Guide', callsign: 'aisha_mohammed', tone: 'kind',
        systemPrompt: 'You are a meditation guide who leads mindfulness practices, breathing exercises, and body scan meditations. You draw from Vipassana, Zen, MBSR, and secular mindfulness traditions. You help beginners build a consistent practice.\n\nMeditation is not about emptying the mind — it is about noticing what is there without judgment. Start small, be consistent, meet people where they are.',
        expertise: ['Mindfulness', 'Breathwork', 'Body Scan', 'MBSR', 'Guided Meditation', 'Stress Reduction'],
        traits: ['calm', 'present', 'non-judgmental', 'encouraging'] },
    ],
  },
  {
    id: 'personal',
    label: 'Personal & Life',
    icon: <HomeIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Rachel Green', title: 'Personal Finance Coach', callsign: 'rachel_green', tone: 'friendly',
        systemPrompt: 'You are a personal finance coach who helps people budget, save, invest, and plan for financial goals. You explain compound interest, retirement accounts, tax strategies, and debt management in simple terms.\n\nFinancial literacy is a life skill. Meet people where they are financially. Create practical, step-by-step plans. Always clarify you are not a licensed financial advisor.',
        expertise: ['Budgeting', 'Saving Strategies', 'Investing Basics', 'Debt Management', 'Retirement Planning', 'Tax Optimization'],
        traits: ['practical', 'non-judgmental', 'clear', 'encouraging'] },
      { name: 'Marco Bianchi', title: 'Legal Advisor (Personal)', callsign: 'marco_bianchi', tone: 'professional',
        systemPrompt: 'You are a personal legal advisor who helps people understand their rights and obligations in everyday situations: tenant law, consumer protection, family law, wills and estates, and small claims.\n\nLegal information empowers people. Explain concepts clearly in plain language. Always note that you provide information, not legal advice, and recommend consulting a licensed attorney for specific cases.',
        expertise: ['Tenant Rights', 'Consumer Law', 'Estate Planning', 'Family Law Basics', 'Contract Review', 'Small Claims'],
        traits: ['clear', 'practical', 'empowering', 'cautious'] },
      { name: 'Olivia Brown', title: 'Home Improvement Guide', callsign: 'olivia_brown', tone: 'friendly',
        systemPrompt: 'You are a home improvement guide who helps with DIY projects, renovations, repairs, and maintenance. You explain tools, materials, techniques, safety precautions, and building codes.\n\nStart with safety. Explain step by step. Recommend when a project is beyond DIY and needs a professional. A well-done home project saves money and builds pride.',
        expertise: ['DIY Projects', 'Tool Selection', 'Repair Techniques', 'Painting/Finishing', 'Plumbing Basics', 'Electrical Safety'],
        traits: ['practical', 'safety-conscious', 'detailed', 'encouraging'] },
      { name: 'Ethan Clark', title: 'Travel Planner', callsign: 'ethan_clark', tone: 'friendly',
        systemPrompt: 'You are a travel planner who crafts unforgettable itineraries. You research destinations, find hidden gems, optimize routes, compare accommodations, and navigate visa requirements and local customs.\n\nTravel broadens perspectives. Plan realistically — leave room for spontaneity. Consider budget, accessibility, and local experiences over tourist traps.',
        expertise: ['Itinerary Planning', 'Destination Research', 'Budget Travel', 'Local Customs', 'Transportation', 'Accommodation'],
        traits: ['adventurous', 'organized', 'culturally-aware', 'resourceful'] },
      { name: 'Maya Desai', title: 'Parenting Advisor', callsign: 'maya_desai', tone: 'kind',
        systemPrompt: 'You are a parenting advisor who provides evidence-based guidance on child development, positive discipline, education choices, screen time management, and family dynamics. You support parents through every stage from newborn to teenager.\n\nEvery child and family is unique. Offer frameworks, not rigid rules. Normalize the challenges. Celebrate the wins. Always prioritize the child\'s wellbeing and safety.',
        expertise: ['Child Development', 'Positive Discipline', 'Education Guidance', 'Family Dynamics', 'Screen Time', 'Adolescent Support'],
        traits: ['empathetic', 'non-judgmental', 'evidence-based', 'supportive'] },
    ],
  },
  {
    id: 'arts',
    label: 'Creative Arts',
    icon: <BrushIcon sx={{ fontSize: 16 }} />,
    crews: [
      { name: 'Lorenzo Ferrari', title: 'Music Producer', callsign: 'lorenzo_ferrari', tone: 'friendly',
        systemPrompt: 'You are a music producer who guides composition, arrangement, mixing, and mastering. You understand music theory, DAWs, synthesis, sampling, and sound design across genres from electronic to orchestral.\n\nGreat production serves the song. Understand the emotional arc. Mix for clarity and impact. Master for translation across playback systems.',
        expertise: ['Music Theory', 'DAW Production', 'Mixing/Mastering', 'Sound Design', 'Arrangement', 'Synthesis'],
        traits: ['creative', 'detail-oriented', 'genre-fluid', 'ear-trained'] },
      { name: 'Zara Ahmed', title: 'Screenwriter', callsign: 'zara_ahmed', tone: 'witty',
        systemPrompt: 'You are a screenwriter who crafts compelling narratives for film and television. You understand three-act structure, character arcs, dialogue, pacing, and genre conventions. You write loglines, treatments, and full scripts.\n\nStory is conflict. Characters must want something badly. Every scene must advance plot, reveal character, or both. Show, don\'t tell.',
        expertise: ['Screenwriting', 'Story Structure', 'Character Development', 'Dialogue Writing', 'Pacing', 'Genre Conventions'],
        traits: ['imaginative', 'structured', 'emotional', 'observant'] },
      { name: 'Theo Svensson', title: 'Photographer', callsign: 'theo_svensson', tone: 'friendly',
        systemPrompt: 'You are a photographer who understands composition, lighting, exposure, and post-processing. You guide on portrait, landscape, street, product, and event photography. You recommend gear and editing workflows.\n\nPhotography is painting with light. Understand the exposure triangle. Compose deliberately. Edit minimally — the best photo is made in-camera.',
        expertise: ['Composition', 'Lighting', 'Exposure Triangle', 'Portrait Photography', 'Post-Processing', 'Gear Selection'],
        traits: ['observant', 'patient', 'visual-thinker', 'technical'] },
      { name: 'Rosa Martinez', title: 'Chef & Recipe Developer', callsign: 'rosa_martinez', tone: 'friendly',
        systemPrompt: 'You are a chef and recipe developer who creates, tests, and refines recipes. You understand flavor pairing, cooking techniques, food science, ingredient substitution, and menu planning for dietary preferences and restrictions.\n\nCooking is both science and art. Recipes should be reproducible and forgiving. Explain the "why" behind techniques. Accommodate allergies and preferences without sacrificing flavor.',
        expertise: ['Recipe Development', 'Flavor Pairing', 'Cooking Techniques', 'Food Science', 'Dietary Adaptations', 'Menu Planning'],
        traits: ['creative', 'precise', 'experimental', 'nurturing'] },
    ],
  },
];

function toCallsign(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function CrewsPanel() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [detailCrew, setDetailCrew] = useState<Crew | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generatingMeta, setGeneratingMeta] = useState(false);
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCategory, setImportCategory] = useState(0);
  const [importLoading, setImportLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await crewsApi.list();
      setCrews(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crews');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try { await crewsApi.toggle(id, enabled); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Toggle failed'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this crew?')) return;
    setBusy(true);
    try { await crewsApi.delete(id); setDetailCrew(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEdit = (c: Crew) => {
    setForm({ name: c.name, title: c.title ?? '', callsign: c.callsign, systemPrompt: c.systemPrompt, tone: c.tone ?? 'professional', expertise: c.expertise ?? [], traits: c.traits ?? [] });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleGenerateMetadata = async () => {
    if (!form.systemPrompt.trim()) return;
    setGeneratingMeta(true);
    try {
      const meta = await crewsApi.generateMetadata(form.systemPrompt);
      setForm((prev) => ({ ...prev, expertise: meta.expertise, traits: meta.traits }));
    } catch {
      setError('Failed to generate skills. You can add them manually.');
    } finally {
      setGeneratingMeta(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.systemPrompt.trim()) { setError('System prompt is required'); return; }
    setBusy(true);
    setError('');
    try {
      const callsign = form.callsign.trim() || toCallsign(form.name);
      const payload: CrewInput = { name: form.name.trim(), title: form.title.trim() || undefined, callsign, systemPrompt: form.systemPrompt.trim(), tone: form.tone, expertise: form.expertise, traits: form.traits };
      if (isEditing) {
        const existing = crews.find(c => c.id === detailCrew?.id);
        if (existing) await crewsApi.update(existing.id, payload);
      } else {
        await crewsApi.create(payload);
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleNameChange = (name: string) => {
    const callsign = form.callsign.trim() ? form.callsign : toCallsign(name);
    setForm({ ...form, name, callsign: form.callsign.trim() ? form.callsign : callsign });
  };

  const handleImportCrew = async (crew: PrebuiltCrew) => {
    setImportLoading(crew.callsign);
    try {
      await crewsApi.create({ name: crew.name, title: crew.title, callsign: crew.callsign, systemPrompt: crew.systemPrompt, tone: crew.tone, expertise: crew.expertise, traits: crew.traits });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImportLoading(null);
    }
  };

  const filtered = crews.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.callsign.toLowerCase().includes(search.toLowerCase()));

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <GroupsIcon sx={{ color: colors.accent.purple, fontSize: 24 }} />
            <Box>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 600 }}>Crews</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mt: 0.25 }}>
                Custom agent personas — each crew defines a unique AI personality
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => { setImportDialogOpen(true); setImportCategory(0); }}
              sx={{ borderColor: colors.accent.blue + '50', color: colors.accent.blue, textTransform: 'none', fontSize: '0.7rem', px: 1.5 }}>
              Import
            </Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}
              sx={{ bgcolor: colors.accent.purple, fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5, '&:hover': { bgcolor: '#9b4fd1' } }}>
              New Crew
            </Button>
          </Box>
        </Box>
      </Box>

      {error && (
        <Box sx={{ px: 3, pb: 0.5 }}>
          <Alert severity="error" sx={{ bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>
        </Box>
      )}

      <Box sx={{ flexShrink: 0, px: 3, pb: 1.5 }}>
        <TextField
          size="small" placeholder="Search crews by name or callsign..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: colors.text.dim }} /></InputAdornment>, sx: { fontSize: '0.7rem' } }}
          sx={{ width: '100%', maxWidth: 360 }}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {crews.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1.5, mt: 2 }}>
            <GroupsIcon sx={{ fontSize: 48, color: colors.text.dim, mb: 2 }} />
            <Typography sx={{ fontSize: '0.85rem', color: colors.text.secondary, mb: 1 }}>No crews yet</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2.5 }}>
              Create your first crew member or import from the prebuilt library
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => { setImportDialogOpen(true); setImportCategory(0); }}
                sx={{ borderColor: colors.accent.blue + '50', color: colors.accent.blue, textTransform: 'none', fontSize: '0.7rem' }}>
                Import Crew
              </Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                sx={{ bgcolor: colors.accent.purple, textTransform: 'none', fontSize: '0.7rem' }}>
                Create Crew
              </Button>
            </Box>
          </Box>
        ) : filtered.length === 0 && search ? (
          <Box sx={{ p: 4, textAlign: 'center', mt: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: colors.text.dim }}>No crews match "{search}"</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2, mt: 1.5 }}>
            {filtered.map((c) => {
              const isEnabled = c.enabled !== false;
              return (
                <Box
                  key={c.id}
                  onClick={() => setDetailCrew(c)}
                  sx={{
                    border: `1px solid ${isEnabled ? colors.accent.green + '40' : colors.border.default}`,
                    borderRadius: 2, bgcolor: colors.bg.secondary, cursor: 'pointer',
                    transition: 'all 0.2s ease', overflow: 'hidden',
                    '&:hover': { borderColor: isEnabled ? colors.accent.green : colors.border.strong, transform: 'translateY(-2px)', boxShadow: isEnabled ? `0 4px 20px ${colors.accent.green}15` : 'none' },
                  }}
                >
                  <Box sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: colors.text.primary }}>{c.name}</Typography>
                        {c.title && (
                          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mt: 0.25 }}>
                            {c.title}
                          </Typography>
                        )}
                        <Typography sx={{ fontSize: '0.6rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
                          @{c.callsign}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        {c.tone && (
                          <Chip size="small" label={c.tone}
                            sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.purple + '20', border: `1px solid ${colors.accent.purple}40`, color: colors.accent.purple }} />
                        )}
                      </Box>
                    </Box>

                    <Typography sx={{ fontSize: '0.7rem', color: colors.text.tertiary, lineHeight: 1.5, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.systemPrompt}
                    </Typography>

                    {(c.expertise && c.expertise.length > 0) && (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                        {c.expertise.slice(0, 3).map((exp) => (
                          <Chip key={exp} size="small" label={exp} sx={{ height: 18, fontSize: '0.5rem', bgcolor: colors.bg.tertiary, color: colors.text.tertiary }} />
                        ))}
                        {c.expertise.length > 3 && (
                          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, alignSelf: 'center' }}>+{c.expertise.length - 3}</Typography>
                        )}
                      </Box>
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <Typography sx={{ fontSize: '0.55rem', color: isEnabled ? colors.accent.green : colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                        {isEnabled ? 'ENABLED' : 'DISABLED'}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Switch size="small" checked={isEnabled}
                        onChange={(e) => { e.stopPropagation(); handleToggle(c.id, !isEnabled); }}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ '& .MuiSwitch-thumb': { bgcolor: isEnabled ? colors.accent.green : colors.text.dim } }} />
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                          sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.blue } }}>
                          <EditIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                          sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Detail Modal */}
      <Dialog open={!!detailCrew} onClose={() => setDetailCrew(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 560, width: '100%' } }}>
        {detailCrew && (() => {
          const isEnabled = detailCrew.enabled !== false;
          return (
            <>
              <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupsIcon sx={{ color: colors.accent.purple, fontSize: 20 }} />
                {detailCrew.name}
              </DialogTitle>
              <DialogContent sx={{ pt: '8px !important' }}>
                {detailCrew.title && (
                  <Typography sx={{ fontSize: '0.75rem', color: colors.text.secondary, mb: 0.5 }}>
                    {detailCrew.title}
                  </Typography>
                )}
                <Typography sx={{ fontSize: '0.7rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", mb: 2 }}>
                  @{detailCrew.callsign}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                  {detailCrew.tone && (
                    <Chip size="small" label={detailCrew.tone}
                      sx={{ height: 22, fontSize: '0.55rem', bgcolor: colors.accent.purple + '20', border: `1px solid ${colors.accent.purple}40`, color: colors.accent.purple }} />
                  )}
                  <Chip size="small" label={isEnabled ? 'Enabled' : 'Disabled'}
                    sx={{ height: 22, fontSize: '0.55rem', color: isEnabled ? colors.accent.green : colors.text.dim, border: `1px solid ${isEnabled ? colors.accent.green + '60' : colors.border.default}` }} variant="outlined" />
                </Box>

                {detailCrew.expertise && detailCrew.expertise.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>Skills & Expertise</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {detailCrew.expertise.map((exp) => (
                        <Chip key={exp} size="small" label={exp} sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.blue + '15', color: colors.accent.blue, border: `1px solid ${colors.accent.blue}30` }} />
                      ))}
                    </Box>
                  </Box>
                )}

                {detailCrew.traits && detailCrew.traits.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>Traits</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {detailCrew.traits.map((t) => (
                        <Chip key={t} size="small" label={t} sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.purple + '10', color: colors.accent.purple, border: `1px solid ${colors.accent.purple}20` }} />
                      ))}
                    </Box>
                  </Box>
                )}

                <Box sx={{ mb: 0 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>System Prompt</Typography>
                  <Box sx={{ p: 2, bgcolor: colors.bg.tertiary, borderRadius: 1, border: `1px solid ${colors.border.default}`, maxHeight: 200, overflow: 'auto' }}>
                    <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap' }}>
                      {detailCrew.systemPrompt}
                    </Typography>
                  </Box>
                </Box>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Switch size="small" checked={isEnabled}
                    onChange={() => handleToggle(detailCrew.id, !isEnabled)}
                    sx={{ '& .MuiSwitch-thumb': { bgcolor: isEnabled ? colors.accent.green : colors.text.dim } }} />
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>{isEnabled ? 'Enabled' : 'Disabled'}</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                    onClick={() => { setDetailCrew(null); openEdit(detailCrew); }}
                    sx={{ borderColor: colors.border.strong, color: colors.text.secondary, textTransform: 'none', fontSize: '0.7rem' }}>
                    Edit
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleDelete(detailCrew.id)}
                    sx={{ borderColor: colors.accent.red + '50', color: colors.accent.red, textTransform: 'none', fontSize: '0.7rem' }}>
                    Delete
                  </Button>
                </Box>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      {/* Create / Edit Modal */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 580, width: '100%' } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px' }}>
          {isEditing ? 'Edit Crew' : 'Create New Crew'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <Box>
            <TextField size="small" label="Name" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              fullWidth placeholder="e.g. Raj Patel" />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              The crew member's full name. This is a person, not a job title.
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Title" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              fullWidth placeholder="e.g. Backend Architect" />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              Their role or specialization. Shown as "Name - Title" in @mentions.
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Callsign" value={form.callsign}
              onChange={(e) => setForm({ ...form, callsign: e.target.value.replace(/\s/g, '').toLowerCase() })}
              fullWidth placeholder="e.g. backend_architect" />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              Auto-generated from name. Unique handle for <Typography component="span" sx={{ fontSize: '0.55rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace" }}>@mentions</Typography> — no spaces.
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 1, textTransform: 'uppercase', letterSpacing: '1px' }}>Tone / Emotion</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {EMOTIONS.map((t) => (
                <Chip key={t} size="small" label={t} onClick={() => setForm({ ...form, tone: t })}
                  sx={{ fontSize: '0.6rem', cursor: 'pointer', bgcolor: form.tone === t ? colors.accent.purple + '30' : 'transparent', border: `1px solid ${form.tone === t ? colors.accent.purple : colors.border.default}`, color: form.tone === t ? colors.accent.purple : colors.text.secondary, '&:hover': { borderColor: colors.accent.purple + '60', bgcolor: colors.accent.purple + '15' } }} />
              ))}
            </Box>
          </Box>

          <Box>
            <TextField size="small" label="System Prompt" value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              fullWidth multiline rows={8} placeholder={SYSTEM_PROMPT_PLACEHOLDER}
              sx={{ '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', lineHeight: 1.6 } }} />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
                Defines personality and behavior. Be specific about domain and skills.
              </Typography>
              <Button size="small" onClick={handleGenerateMetadata} disabled={generatingMeta || !form.systemPrompt.trim()}
                startIcon={generatingMeta ? <CircularProgress size={12} /> : <SmartToyIcon sx={{ fontSize: 13 }} />}
                sx={{ fontSize: '0.55rem', textTransform: 'none', color: colors.accent.cyan, minWidth: 'auto' }}>
                {generatingMeta ? 'Analyzing...' : 'Auto-tag'}
              </Button>
            </Box>
          </Box>

          {(form.expertise.length > 0 || form.traits.length > 0) && (
            <Box sx={{ p: 1.5, borderRadius: 1, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.tertiary }}>
              {form.expertise.length > 0 && (
                <Box sx={{ mb: form.traits.length > 0 ? 1 : 0 }}>
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mb: 0.5 }}>Expertise</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {form.expertise.map((exp) => (
                      <Chip key={exp} size="small" label={exp} onDelete={() => setForm({ ...form, expertise: form.expertise.filter((e) => e !== exp) })}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.blue + '15', color: colors.accent.blue }} />
                    ))}
                  </Box>
                </Box>
              )}
              {form.traits.length > 0 && (
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mb: 0.5 }}>Traits</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {form.traits.map((t: string) => (
                      <Chip key={t} size="small" label={t} onDelete={() => setForm({ ...form, traits: form.traits.filter((tr) => tr !== t) })}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.purple + '10', color: colors.accent.purple }} />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.75rem' }}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy} variant="contained"
            sx={{ bgcolor: colors.accent.purple, textTransform: 'none', fontSize: '0.75rem', px: 2.5, '&:hover': { bgcolor: '#9b4fd1' } }}>
            {busy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            {isEditing ? 'Save Changes' : 'Create Crew'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Import Prebuilt Crews Modal */}
      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 700, width: '100%', maxHeight: '85vh' } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Import Prebuilt Crew
          <IconButton size="small" onClick={() => setImportDialogOpen(false)}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Tabs value={importCategory} onChange={(_, v) => setImportCategory(v)}
            variant="scrollable" scrollButtons="auto"
            sx={{ mb: 2, '& .MuiTab-root': { fontSize: '0.65rem', textTransform: 'none', minWidth: 'auto', px: 1.5, py: 0.75 }, '& .Mui-selected': { color: colors.accent.purple } }}>
            {PREBUILT_CATEGORIES.map((cat, _idx) => (
              <Tab key={cat.id} label={cat.label} icon={cat.icon} iconPosition="start" />
            ))}
          </Tabs>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1.5 }}>
            {PREBUILT_CATEGORIES[importCategory]?.crews.map((pc) => {
              const alreadyImported = crews.some((c) => c.callsign === pc.callsign);
              return (
                <Box key={pc.callsign} sx={{ p: 1.75, borderRadius: 1.5, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.tertiary }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box>
                      <Typography sx={{ fontWeight: 600, fontSize: '0.78rem' }}>{pc.name}</Typography>
                      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary }}>{pc.title}</Typography>
                      <Typography sx={{ fontSize: '0.6rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace" }}>@{pc.callsign}</Typography>
                    </Box>
                    {pc.tone && (
                      <Chip size="small" label={pc.tone} sx={{ height: 18, fontSize: '0.5rem', bgcolor: colors.accent.purple + '20', border: `1px solid ${colors.accent.purple}40`, color: colors.accent.purple }} />
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                    {pc.expertise.slice(0, 4).map((exp) => (
                      <Chip key={exp} size="small" label={exp} sx={{ height: 18, fontSize: '0.5rem', bgcolor: colors.bg.primary }} />
                    ))}
                  </Box>
                  {alreadyImported ? (
                    <Typography sx={{ fontSize: '0.6rem', color: colors.accent.green, textAlign: 'center', py: 0.5 }}>
                      Already imported
                    </Typography>
                  ) : (
                    <Button size="small" variant="outlined" fullWidth
                      onClick={() => handleImportCrew(pc)} disabled={importLoading === pc.callsign}
                      sx={{ fontSize: '0.6rem', textTransform: 'none', borderColor: colors.accent.blue + '50', color: colors.accent.blue, mt: 0.5 }}>
                      {importLoading === pc.callsign ? <CircularProgress size={12} sx={{ mr: 1 }} /> : null}
                      Add Crew
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
