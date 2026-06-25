/**
 * Global occupation categories — ISCO/SOC-aligned job role coverage.
 * Merged into generate-crew-hub.mjs — each category has >= 20 unique role titles.
 */

function rolesFromTitles(categoryLabel, titles, specialtyPrefix) {
  return titles.map((title) => ({
    title,
    specialty: `${specialtyPrefix} for ${title.toLowerCase()} — planning, execution, and operational guidance`,
  }));
}

const businessTraits = ['strategic', 'organized', 'communicative', 'results-driven', 'adaptable', 'detail-oriented'];
const fieldTraits = ['practical', 'hands-on', 'safety-conscious', 'detail-oriented', 'patient', 'resourceful'];
const serviceTraits = ['customer-focused', 'reliable', 'empathetic', 'efficient', 'professional', 'adaptable'];

/** @returns {import('./generate-crew-hub.mjs').CategoryDef[]} */
export function worldOccupationCategoryDefinitions() {
  const defs = [];

  const addBusiness = (id, label, iconId, titles) => {
    defs.push({
      id,
      label,
      iconId,
      businessCategory: true,
      skillBank: ['Operations', 'Stakeholder Management', 'Process Design', 'Compliance', 'Budgeting', 'Communication', 'Quality Control', 'Scheduling', 'Vendor Management', 'Reporting', 'Team Leadership', 'Customer Service'],
      traitBank: businessTraits,
      roles: rolesFromTitles(label, titles, 'business operations and professional practice'),
    });
  };

  const addField = (id, label, iconId, titles, skillBank) => {
    defs.push({
      id,
      label,
      iconId,
      skillBank: skillBank ?? ['Safety Protocols', 'Tool Mastery', 'Blueprint Reading', 'Code Compliance', 'Troubleshooting', 'Customer Communication', 'Estimating', 'Material Selection', 'Quality Inspection', 'Maintenance', 'Site Management', 'Regulatory Standards'],
      traitBank: fieldTraits,
      roles: rolesFromTitles(label, titles, 'trade practice and field operations'),
    });
  };

  const addService = (id, label, iconId, titles) => {
    defs.push({
      id,
      label,
      iconId,
      skillBank: ['Client Service', 'Scheduling', 'Quality Standards', 'Safety', 'Inventory', 'Communication', 'Problem Solving', 'Upselling', 'Compliance', 'Team Coordination', 'Feedback Handling', 'Local Marketing'],
      traitBank: serviceTraits,
      roles: rolesFromTitles(label, titles, 'service delivery and client experience'),
    });
  };

  // ─── Education ───────────────────────────────────────────────────────
  addBusiness('k12-teaching-instruction', 'K-12 Teaching & Instruction', 'school', [
    'Elementary Classroom Teacher', 'Middle School Math Teacher', 'High School English Teacher', 'Science Lab Instructor',
    'Social Studies Curriculum Teacher', 'Specialist STEM Teacher', 'Reading Intervention Teacher', 'ESL Classroom Teacher',
    'Substitute Teacher Coordinator', 'Remote Learning Facilitator', 'Gifted & Talented Instructor', 'After-School Program Teacher',
    'Vocational Shop Teacher', 'Music Band Director', 'Art Studio Teacher', 'Physical Education Instructor',
    'Library Media Classroom Liaison', 'Yearbook Faculty Advisor', 'Student Council Mentor Teacher', 'Homeroom Advisory Teacher',
    'Curriculum Mapping Lead Teacher', 'New Teacher Induction Coach',
  ]);

  addBusiness('early-childhood-education', 'Early Childhood & Daycare', 'school', [
    'Infant Room Caregiver', 'Toddler Development Specialist', 'Preschool Lead Teacher', 'Montessori Guide',
    'Reggio Emilia Educator', 'Family Childcare Provider', 'Daycare Center Director', 'Early Literacy Coach',
    'Child Development Assessment Specialist', 'Play-Based Learning Designer', 'Early Intervention Educator', 'Parent Engagement Coordinator',
    'Nutrition & Meal Planning ECE Specialist', 'Outdoor Nature Preschool Educator', 'Bilingual Early Childhood Teacher', 'Special Needs Inclusion ECE Teacher',
    'Licensing Compliance Daycare Advisor', 'ECE Curriculum Developer', 'Infant Sleep Safety Trainer', 'Early Childhood Trauma-Informed Educator',
    'Head Start Program Coordinator', 'Early Childhood Workforce Trainer',
  ]);

  addBusiness('special-education-inclusion', 'Special Education & Inclusion', 'school', [
    'IEP Case Manager', 'Resource Room Special Educator', 'Autism Spectrum Classroom Specialist', 'Learning Disability Interventionist',
    'Speech-Language Pathologist School Liaison', 'Occupational Therapy School Consultant', 'Behavior Intervention Specialist', 'Transition Services Coordinator',
    'Inclusive Co-Teaching Specialist', 'Assistive Technology Educator', 'Deaf & Hard of Hearing Program Teacher', 'Vision Impairment Itinerant Teacher',
    'Emotional Behavioral Disorder Specialist', 'Multi-Tiered Support Systems Coach', 'Special Education Compliance Officer', '504 Plan Coordinator',
    'Adaptive PE Specialist', 'Functional Life Skills Teacher', 'Parent Advocate Special Education Coach', 'Special Education Data Analyst',
    'Restraint & Seclusion Policy Trainer', 'Universal Design for Learning Facilitator',
  ]);

  addBusiness('vocational-trade-instruction', 'Vocational & Trade School Instruction', 'construction', [
    'Automotive Technology Instructor', 'Welding Program Teacher', 'Culinary Arts Instructor', 'Cosmetology School Educator',
    'Electrical Apprenticeship Instructor', 'HVAC Trade School Teacher', 'Nursing Assistant Program Instructor', 'Medical Assistant Trainer',
    'Construction Trades Instructor', 'Computer IT Bootcamp Instructor', 'Pharmacy Technician Trainer', 'Dental Assistant Program Educator',
    'Commercial Driver Training Instructor', 'Machinist Apprenticeship Teacher', 'Plumbing Code Instructor', 'Esthetics School Educator',
    'Court Reporting Program Teacher', 'Real Estate Pre-License Instructor', 'Firefighter Academy Instructor', 'Police Training Academy Educator',
    'Apprenticeship Program Coordinator', 'Workforce Development Liaison',
  ]);

  // ─── Financial Services ──────────────────────────────────────────────
  addBusiness('banking-commercial-finance', 'Banking & Commercial Finance', 'balance', [
    'Commercial Loan Officer', 'Retail Bank Branch Manager', 'Mortgage Origination Specialist', 'Credit Analyst',
    'Treasury Management Advisor', 'Small Business Banking Relationship Manager', 'Consumer Lending Underwriter', 'Bank Operations Manager',
    'Anti-Money Laundering Analyst', 'KYC Onboarding Specialist', 'Branch Teller Trainer', 'Mobile Banking Product Manager',
    'Core Banking Systems Analyst', 'Collections & Recovery Specialist', 'Deposit Products Marketing Manager', 'Trade Finance Specialist',
    'Letters of Credit Advisor', 'Bank Compliance Officer', 'Community Reinvestment Act Coordinator', 'Wealth Referral Banking Advisor',
    'Neobank Operations Specialist', 'Bank Fraud Investigation Analyst',
  ]);

  addBusiness('investment-capital-markets', 'Investment Banking & Capital Markets', 'trending', [
    'Mergers & Acquisitions Analyst', 'Equity Capital Markets Associate', 'Debt Capital Markets Structurer', 'Leveraged Finance Analyst',
    'IPO Process Project Manager', 'Private Equity Associate', 'Venture Capital Analyst', 'Hedge Fund Research Analyst',
    'Fixed Income Trader Support Specialist', 'Derivatives Sales Strategist', 'Corporate Finance Modeling Analyst', 'Restructuring Advisory Associate',
    'ESG Investment Analyst', 'Secondary Market Private Equity Specialist', 'Fundraising Investor Relations Manager', 'Cap Table Management Advisor',
    'SPAC Transaction Advisor', 'PIPE Financing Specialist', 'Limited Partner Relations Manager', 'Investment Banking Compliance Officer',
    'Due Diligence Data Room Manager', 'Capital Markets Technology Product Owner',
  ]);

  addBusiness('wealth-management-advisory', 'Wealth Management & Financial Planning', 'trending', [
    'Certified Financial Planner', 'Private Wealth Advisor', 'Estate Planning Wealth Strategist', 'Retirement Income Planner',
    'Tax-Efficient Investing Advisor', 'Trust Services Officer', 'Family Office Chief of Staff', 'Philanthropic Advisory Specialist',
    'Insurance & Annuity Wealth Integrator', 'Divorce Financial Analyst', 'Stock Plan Executive Advisor', 'Cross-Border Wealth Manager',
    'Robo-Advisory Hybrid Planner', 'Behavioral Finance Coach', 'College Savings 529 Specialist', 'Charitable Remainder Trust Advisor',
    'Wealth Technology Platform Consultant', 'Multi-Generational Wealth Educator', 'Alternative Investment Allocator', 'Risk Profiling Questionnaire Designer',
    'Wealth Management Compliance Reviewer', 'Client Onboarding Wealth Operations Manager',
  ]);

  addBusiness('actuarial-quantitative-risk', 'Actuarial Science & Quantitative Risk', 'analytics', [
    'Life Insurance Actuary', 'Property Casualty Actuary', 'Health Actuarial Analyst', 'Pension Actuarial Consultant',
    'Enterprise Risk Management Actuary', 'Catastrophe Modeling Specialist', 'Pricing Actuarial Analyst', 'Reserving Actuary',
    'Predictive Modeling Actuary', 'Capital Modeling Solvency Specialist', 'Actuarial Exam Coach', 'Microinsurance Product Actuary',
    'Reinsurance Treaty Analyst', 'Workers Comp Actuarial Specialist', 'Cyber Risk Quantitative Analyst', 'Climate Risk Actuarial Advisor',
    'Actuarial Software Implementation Consultant', 'Experience Study Analyst', 'Actuarial Fairness Auditor', 'Embedded Insurance Actuary',
    'Actuarial Communication Stakeholder Advisor', 'Actuarial Regulatory Filing Specialist',
  ]);

  // ─── Social Services ─────────────────────────────────────────────────
  addBusiness('social-work-human-services', 'Social Work & Human Services', 'volunteer', [
    'Clinical Social Worker', 'Healthcare Discharge Planning Social Worker', 'School Social Worker', 'Child Welfare Caseworker',
    'Adult Protective Services Investigator', 'Housing First Case Manager', 'Substance Abuse Counselor Social Worker', 'Veterans Benefits Navigator',
    'Domestic Violence Shelter Advocate', 'Refugee Resettlement Case Manager', 'Geriatric Care Social Worker', 'Hospice Bereavement Social Worker',
    'Community Mental Health Outreach Worker', 'Foster Care Licensing Worker', 'Adoption Home Study Specialist', 'Probation Social Work Liaison',
    'Disability Services Coordinator', 'Food Bank Program Social Worker', 'Crisis Intervention Hotline Social Worker', 'Policy Advocacy Social Worker',
    'Social Work Supervisor Clinical Director', 'Telehealth Social Work Program Manager',
  ]);

  addBusiness('child-family-welfare', 'Child & Family Welfare Services', 'favorite', [
    'Family Preservation Caseworker', 'Parenting Skills Program Facilitator', 'Kinship Care Support Specialist', 'Child Abuse Investigation Worker',
    'Foster Parent Trainer', 'Reunification Case Planner', 'Juvenile Court Liaison', 'Early Head Start Family Advocate',
    'Teen Independent Living Coach', 'Family Visitation Supervision Monitor', 'Child Support Enforcement Officer', 'Safe Sleep Infant Educator',
    'Trauma-Informed Family Therapist Liaison', 'Family Drug Court Case Manager', 'NICU Social Support Family Specialist', 'Grandparent Caregiver Navigator',
    'Family Strengthening Program Director', 'Parent-Child Interaction Therapy Coach', 'Child Welfare Data Quality Analyst', 'Family Resource Center Coordinator',
    'Mandatory Reporter Training Facilitator', 'Family Court Mediation Support Specialist',
  ]);

  // ─── Skilled Trades ────────────────────────────────────────────────────
  addField('electrical-trades-power', 'Electrical Trades & Power Systems', 'construction', [
    'Residential Electrician', 'Commercial Electrician', 'Industrial Electrician', 'Master Electrician Estimator',
    'Low Voltage Systems Installer', 'Solar PV Electrician', 'EV Charger Installation Specialist', 'Fire Alarm Systems Technician',
    'Electrical Inspector Code Advisor', 'Substation Maintenance Technician', 'Lineworker Safety Trainer', 'Motor Control Technician',
    'PLC Programming Electrician', 'Data Center Critical Power Technician', 'Smart Home Wiring Integrator', 'Electrical Apprenticeship Mentor',
    'Arc Flash Safety Compliance Advisor', 'Electrical Forensics Investigator', 'Wind Turbine Electrical Technician', 'Battery Storage Systems Electrician',
    'Electrical Service Dispatcher', 'Electrical Wholesale Counter Specialist',
  ]);

  addField('plumbing-hvac-trades', 'Plumbing, Heating & HVAC Trades', 'construction', [
    'Residential Plumber', 'Commercial Plumbing Contractor', 'Pipefitter Steam Systems Specialist', 'HVAC Installation Technician',
    'HVAC Service & Repair Technician', 'Refrigeration Mechanic', 'Boiler Operator & Maintainer', 'Backflow Prevention Tester',
    'Hydronic Radiant Heating Installer', 'Drain & Sewer Line Specialist', 'Gas Line Installation Technician', 'Plumbing Inspector Advisor',
    'Green Building HVAC Designer', 'Indoor Air Quality HVAC Specialist', 'Duct Cleaning & Sealing Technician', 'HVAC Controls BMS Technician',
    'Geothermal Heat Pump Installer', 'Medical Gas Systems Plumber', 'Plumbing Apprenticeship Instructor', 'Emergency Plumbing Dispatcher',
    'HVAC Energy Audit Technician', 'Plumbing Supply Showroom Consultant',
  ]);

  addField('carpentry-masonry-finishing', 'Carpentry, Masonry & Finishing Trades', 'construction', [
    'Finish Carpenter', 'Framing Carpenter', 'Cabinetmaker & Millworker', 'Concrete Mason',
    'Bricklayer & Stonemason', 'Drywall Installer & Finisher', 'Painter & Decorator', 'Flooring Installer',
    'Roofing Contractor', 'Siding & Exterior Specialist', 'Tile Setter', 'Insulation Installer',
    'Scaffolding Erector', 'Demolition Safety Supervisor', 'Historic Restoration Mason', 'Staircase & Railing Fabricator',
    'Formwork Carpenter', 'Waterproofing Specialist', 'Acoustical Ceiling Installer', 'Countertop Fabricator',
    'Construction Superintendent Trade Lead', 'Blueprint Takeoff Estimator',
  ]);

  // ─── Transportation & Automotive ───────────────────────────────────────
  addBusiness('automotive-sales-service', 'Automotive Sales & Service', 'devices', [
    'Automotive Service Technician', 'Master Automotive Diagnostic Specialist', 'Auto Body Collision Repair Technician', 'Automotive Detailer',
    'Used Car Sales Consultant', 'New Car Sales Specialist', 'Fleet Maintenance Manager', 'Automotive Parts Counter Specialist',
    'Tire & Wheel Service Technician', 'Automotive Service Advisor', 'EV Battery Service Technician', 'Automotive Shop Foreman',
    'Dealership Finance & Insurance Manager', 'Automotive Auction Operations Manager', 'Classic Car Restoration Specialist', 'Automotive Quality Inspector',
    'Roadside Assistance Dispatcher', 'Automotive Warranty Claims Administrator', 'Automotive Training Instructor', 'Dealership General Manager',
    'Automotive Digital Retailing Specialist', 'Automotive Compliance Title Clerk',
  ]);

  addBusiness('aviation-airline-operations', 'Aviation & Airline Operations', 'flight', [
    'Airline Pilot Career Advisor', 'Flight Attendant Trainer', 'Aircraft Maintenance Technician', 'Air Traffic Control Operations Educator',
    'Airport Ground Operations Manager', 'Baggage Handling Systems Supervisor', 'Airline Revenue Management Analyst', 'Aviation Safety Management Specialist',
    'Aircraft Dispatcher', 'Airport Security Screening Operations Manager', 'Aviation Fueling Operations Specialist', 'MRO Maintenance Planning Manager',
    'Airline Crew Scheduling Analyst', 'Aviation Meteorology Briefing Specialist', 'Drone Commercial Operations Pilot', 'Airport Customer Experience Manager',
    'Aviation Regulatory Compliance Officer', 'Flight Simulator Training Instructor', 'Air Cargo Operations Coordinator', 'Aviation Human Factors Specialist',
    'Airline Loyalty Program Manager', 'Aviation Sustainability Fuel Advisor',
  ]);

  addBusiness('maritime-port-operations', 'Maritime Shipping & Port Operations', 'maritime', [
    'Ship Captain Career Advisor', 'Marine Engineer Officer', 'Stevedore Cargo Operations Supervisor', 'Port Harbor Master Liaison',
    'Container Terminal Operations Manager', 'Maritime Logistics Coordinator', 'Ship Chandler Supply Specialist', 'Marine Surveyor',
    'Offshore Rig Operations Advisor', 'Ferry Operations Manager', 'Maritime Safety ISM Auditor', 'Longshoreman Shift Supervisor',
    'Customs Broker Maritime Specialist', 'Ballast Water Compliance Officer', 'Maritime Pilotage Operations Educator', 'Cruise Ship Hotel Operations Manager',
    'Shipbuilding Project Manager', 'Marine Insurance Claims Adjuster', 'Maritime Search Rescue Coordinator', 'Dry Dock Planning Specialist',
    'Maritime Cybersecurity Officer', 'Inland Waterway Barge Operator',
  ]);

  addBusiness('postal-courier-delivery', 'Postal, Courier & Last-Mile Delivery', 'shipping', [
    'Postal Mail Carrier', 'Package Delivery Driver', 'Last-Mile Route Optimization Planner', 'Courier Dispatch Supervisor',
    'Fulfillment Sortation Center Manager', 'Returns Processing Operations Lead', 'Cold Chain Delivery Specialist', 'Same-Day Delivery Operations Coordinator',
    'Postal Clerk Window Service Specialist', 'Address Verification Data Specialist', 'Delivery Drone Operations Pilot', 'Freight Bike Courier Coordinator',
    'International Express Customs Clearance Specialist', 'Proof of Delivery Technology Manager', 'Delivery Associate Trainer', 'Rural Route Postal Specialist',
    'Locker & Pickup Point Network Manager', 'Delivery Fleet Maintenance Coordinator', 'Gig Economy Delivery Platform Onboarding Specialist', 'Postal Regulatory Compliance Officer',
    'Undeliverable Mail Resolution Specialist', 'Sustainable Delivery Fleet Planner',
  ]);

  // ─── Media, Telecom, Creative Production ─────────────────────────────
  addBusiness('telecom-network-operations', 'Telecommunications & Network Operations', 'lan', [
    'Fiber Optic Installation Technician', '5G Network Deployment Engineer', 'Telecom Tower Climber Safety Specialist', 'NOC Network Operations Analyst',
    'VoIP Systems Administrator', 'Broadband Customer Provisioning Specialist', 'Telecom Billing Mediation Analyst', 'RF Drive Test Engineer',
    'Satellite Communications Technician', 'Telecom Regulatory Spectrum Advisor', 'Last-Mile ISP Operations Manager', 'Telecom Field Service Dispatcher',
    'Unified Communications Engineer', 'Telecom Fraud Prevention Analyst', 'Submarine Cable Operations Specialist', 'Telecom Project Rollout Manager',
    'Rural Broadband Grant Program Manager', 'Telecom Customer NOC Escalation Lead', 'Microwave Backhaul Engineer', 'Telecom Asset Inventory Manager',
    'Open RAN Deployment Specialist', 'Telecom Disaster Recovery Coordinator',
  ]);

  addBusiness('film-tv-broadcast-production', 'Film, TV & Broadcast Production', 'videogame', [
    'Film Director Career Advisor', 'Cinematographer Lighting Specialist', 'Production Sound Mixer', 'Film Editor Post-Production Lead',
    'Broadcast News Producer', 'TV Script Supervisor', 'Casting Director', 'Location Scout Manager',
    'Grip & Electric Department Lead', 'Production Designer Art Director', 'VFX Supervisor', 'Colorist Post-Production Specialist',
    'Documentary Field Producer', 'Live Broadcast Director', 'Talent Agent Career Coach', 'Stunt Coordinator Safety Advisor',
    'Production Accountant Entertainment', 'Film Festival Programming Advisor', 'Streaming Content Acquisition Manager', 'Broadcast Engineering Transmitter Specialist',
    'Unscripted Reality Show Runner', 'Entertainment Labor Compliance Manager',
  ]);

  addBusiness('photography-videography-services', 'Photography & Videography Services', 'brush', [
    'Wedding Photographer', 'Commercial Product Photographer', 'Portrait Studio Photographer', 'Real Estate Listing Photographer',
    'Event Videographer', 'Corporate Headshot Photographer', 'Drone Aerial Photographer', 'Photo Retoucher & Editor',
    'School Portrait Photography Coordinator', 'Sports Action Photographer', 'Food Photography Stylist', 'Fashion Editorial Photographer',
    'Newborn & Family Portrait Specialist', 'Architectural Photography Specialist', 'Video Color Grading Specialist', 'Live Stream Multi-Camera Director',
    'Stock Photography Portfolio Manager', 'Photography Studio Manager', 'Camera Rental House Specialist', 'Photography Workshop Instructor',
    'Copyright & Licensing Photography Advisor', 'Photography Business Marketing Coach',
  ]);

  addBusiness('music-performing-arts', 'Music & Performing Arts', 'brush', [
    'Orchestra Conductor Career Advisor', 'Session Musician Contractor', 'Music Producer Recording Engineer', 'Vocal Coach Performance Specialist',
    'Theater Stage Manager', 'Ballet Company Rehearsal Director', 'Opera Production Manager', 'Choir Director Community Ensemble',
    'Music Therapist Performance Liaison', 'Touring Band Road Manager', 'Music Licensing Sync Specialist', 'Instrument Repair Luthier',
    'DJ Event Entertainment Specialist', 'Musical Theater Choreographer', 'Arts Festival Programming Director', 'Performing Arts Venue Manager',
    'Music School Private Lesson Director', 'Casting Musician Union Contractor', 'Live Sound Front of House Engineer', 'Performing Arts Grant Writer',
    'Stage Combat Coordinator', 'Performing Arts Accessibility Coordinator',
  ]);

  // ─── Industry & Energy ─────────────────────────────────────────────────
  addBusiness('fashion-apparel-textiles', 'Fashion, Apparel & Textiles', 'palette', [
    'Fashion Designer Collection Lead', 'Apparel Technical Designer', 'Textile Mill Production Manager', 'Fashion Merchandiser Buyer',
    'Pattern Maker Grading Specialist', 'Sustainable Fashion Supply Chain Advisor', 'Costume Designer Entertainment', 'Fashion Stylist Editorial',
    'Footwear Design Developer', 'Luxury Brand Retail Manager', 'Fashion E-Commerce Catalog Manager', 'Textile Quality Lab Technician',
    'Fashion Show Production Coordinator', 'Apparel Sourcing Agent', 'Denim Wash Development Specialist', 'Fashion Trend Forecast Analyst',
    'Vintage Resale Curator', 'Fashion PR Publicist', 'Uniform & Workwear Designer', 'Textile Dye House Chemist',
    'Fashion Influencer Partnership Manager', 'Circular Fashion Recycling Program Manager',
  ]);

  addBusiness('mining-mineral-extraction', 'Mining & Mineral Extraction', 'factory', [
    'Underground Mine Supervisor', 'Open Pit Mine Planner', 'Mine Safety Health Administrator', 'Geologist Exploration Specialist',
    'Blasting Engineer Mining', 'Mineral Processing Plant Operator', 'Mine Ventilation Engineer', 'Heavy Equipment Mining Operator',
    'Metallurgist Ore Processing Specialist', 'Mine Environmental Reclamation Manager', 'Coal Mine Inspector Liaison', 'Diamond Sorting & Valuation Specialist',
    'Mining Automation Remote Operations Technician', 'Artisanal Mining Safety Trainer', 'Mine Rescue Team Coordinator', 'Mining Logistics Haul Road Manager',
    'Critical Minerals Supply Chain Analyst', 'Mine Community Relations Officer', 'Mining Feasibility Study Consultant', 'Tailings Dam Safety Monitor',
    'Mining Workforce Training Instructor', 'Mining Permitting Regulatory Specialist',
  ]);

  addBusiness('oil-gas-upstream', 'Oil & Gas Upstream Operations', 'energy', [
    'Drilling Engineer Advisor', 'Rig Site Supervisor', 'Petroleum Geologist Exploration Specialist', 'Reservoir Engineer',
    'Well Completion Specialist', 'Production Operator Upstream', 'HSE Oilfield Safety Officer', 'Pipeline Integrity Inspector',
    'Offshore Platform Operations Manager', 'Hydraulic Fracturing Operations Advisor', 'Well Logging Analyst', 'Oilfield Supply Chain Coordinator',
    'Subsea Engineering Specialist', 'Refinery Turnaround Planner', 'LNG Terminal Operations Manager', 'Carbon Capture Storage Project Manager',
    'Decommissioning Offshore Advisor', 'Oil Trading Operations Analyst', 'Petrochemical Plant Process Engineer', 'Renewable Transition Oil Major Advisor',
    'Oilfield Emergency Response Coordinator', 'Upstream Data Analytics Production Advisor',
  ]);

  addBusiness('pharma-biotech-commercial', 'Pharmaceuticals & Biotech Commercial', 'biotech', [
    'Pharmaceutical Sales Representative', 'Medical Science Liaison', 'Clinical Trial Manager', 'Regulatory Affairs Submission Specialist',
    'Pharmacovigilance Drug Safety Analyst', 'Biotech Manufacturing Process Scientist', 'Quality Assurance GMP Specialist', 'Medical Affairs Strategy Director',
    'Health Economics Outcomes Researcher', 'Pharma Market Access Manager', 'Biologics Cell Culture Scientist', 'Clinical Data Management Lead',
    'Investigational New Drug Program Manager', 'Pharma Supply Chain Cold Chain Manager', 'Biotech IP Licensing Manager', 'Patient Advocacy Pharma Liaison',
    'Comparator Sourcing Clinical Trial Specialist', 'Pharma Compliance Promotion Reviewer', 'Biotech Startup Business Development Manager', 'Gene Therapy Manufacturing Advisor',
    'Pharma Serialization Track & Trace Manager', 'Rare Disease Launch Strategy Manager',
  ]);

  addBusiness('clinical-research-trials', 'Clinical Research & Trial Operations', 'science', [
    'Clinical Research Associate Monitor', 'Principal Investigator Study Coach', 'Clinical Trial Coordinator', 'IRB Submission Specialist',
    'Patient Recruitment Clinical Trial Manager', 'Clinical Trial Budget & Contract Specialist', 'GCP Audit Quality Assurance Manager', 'Electronic Data Capture Administrator',
    'Biostatistician Clinical Trial Designer', 'Clinical Supply Chain Manager', 'Trial Master File Document Specialist', 'Decentralized Clinical Trial Operations Manager',
    'Clinical Trial Patient Navigator', 'Pharmacokinetics Study Specialist', 'Clinical Trial Safety Reporting Specialist', 'Site Feasibility Assessment Manager',
    'Clinical Trial Diversity Enrollment Strategist', 'Medical Writer Clinical Study Report Specialist', 'Clinical Trial Technology Platform Manager', 'Post-Market Surveillance Study Manager',
    'Clinical Trial Closeout Archiving Specialist', 'Clinical Research Training Compliance Officer',
  ]);

  // ─── Personal Services ─────────────────────────────────────────────────
  addService('beauty-cosmetology-personal-care', 'Beauty, Cosmetology & Personal Care', 'palette', [
    'Licensed Cosmetologist', 'Hair Color Specialist', 'Barber Shop Owner', 'Nail Technician Salon Specialist',
    'Esthetician Facial Skincare Specialist', 'Makeup Artist Bridal', 'Lash Extension Technician', 'Microblading Brow Specialist',
    'Spa Massage Therapist Manager', 'Salon Suite Independent Stylist', 'Beauty School Instructor', 'Salon Retail Product Consultant',
    'Men\'s Grooming Barber Specialist', 'Spray Tan Technician', 'Waxing Hair Removal Specialist', 'Beauty Influencer Brand Ambassador',
    'Salon Scheduling Front Desk Manager', 'Cosmetology State Board Exam Coach', 'Clean Beauty Formulation Consultant', 'Med Spa Treatment Coordinator',
    'Salon Health Sanitation Compliance Advisor', 'Beauty Franchise Operations Manager',
  ]);

  addService('funeral-death-care', 'Funeral & Death Care Services', 'home', [
    'Funeral Director Embalmer', 'Crematory Operations Manager', 'Grief Support Funeral Counselor', 'Pre-Need Funeral Sales Counselor',
    'Cemetery Plot Sales Advisor', 'Mortuary Transport Removal Specialist', 'Funeral Celebrant Officiant', 'Green Burial Options Educator',
    'Funeral Home Operations Manager', 'Memorial Video Tribute Producer', 'Death Certificate Filing Administrator', 'Funeral Floral Arrangement Specialist',
    'Veterans Funeral Benefits Navigator', 'Cultural Religious Funeral Customs Advisor', 'Pet Aftercare Cremation Specialist', 'Funeral Trust Fund Compliance Officer',
    'Coroner Medical Examiner Liaison', 'Funeral Home Marketing Community Outreach Manager', 'Thanatology Grief Educator', 'Funeral Technology Livestream Specialist',
    'Monument Memorial Sales Consultant', 'Funeral Service Apprenticeship Instructor',
  ]);

  addService('cleaning-facilities-janitorial', 'Facilities, Cleaning & Janitorial', 'home', [
    'Commercial Janitorial Supervisor', 'Hospital Environmental Services Manager', 'Carpet & Upholstery Cleaning Specialist', 'Window Cleaning High-Rise Technician',
    'Industrial Floor Coating Specialist', 'Post-Construction Cleanup Contractor', 'Green Cleaning Chemical Safety Trainer', 'Restroom Sanitation Quality Inspector',
    'Facilities Day Porter', 'Crime Scene Biohazard Remediation Specialist', 'HVAC Duct Cleaning Technician', 'Pressure Washing Exterior Specialist',
    'Janitorial Supply Purchasing Manager', 'School Custodial Night Shift Lead', 'Data Center Cleanroom Technician', 'Food Plant Sanitation Supervisor',
    'Facilities Waste Diversion Coordinator', 'Janitorial Franchise Owner', 'Cleaning Quality Audit Inspector', 'Facilities Odor Remediation Specialist',
    'Janitorial Staffing Scheduler', 'Facilities Sustainability Cleaning Advisor',
  ]);

  addService('private-security-protective', 'Private Security & Protective Services', 'police', [
    'Corporate Security Director', 'Executive Protection Agent', 'Security Guard Shift Supervisor', 'CCTV Monitoring Control Room Operator',
    'Event Security Crowd Manager', 'Loss Prevention Retail Investigator', 'Access Control Systems Administrator', 'Security Training Firearms Instructor',
    'K-9 Security Handler', 'Maritime Ship Security Officer', 'Campus Security Operations Manager', 'Cyber-Physical Security Integration Specialist',
    'Background Screening Investigator', 'Security Consultant Risk Assessor', 'Armored Car Courier Guard', 'Residential Gated Community Security Manager',
    'Security Patrol Route Planner', 'Workplace Violence Prevention Trainer', 'Security Guard Licensing Compliance Advisor', 'Drone Surveillance Security Operator',
    'VIP Airport Meet & Greet Security Liaison', 'Security Operations Center Analyst',
  ]);

  // ─── Defense, Sports, Fitness ──────────────────────────────────────────
  addBusiness('military-defense-operations', 'Military & Defense Operations', 'landmark', [
    'Military Officer Career Transition Coach', 'Defense Contracting Program Manager', 'Logistics Military Supply Specialist', 'Military Intelligence Analyst',
    'Defense Acquisition Lifecycle Manager', 'Veteran Benefits Navigator', 'Military Family Support Services Coordinator', 'ROTC Program Advisor',
    'Defense Cyber Operations Specialist', 'Military Aviation Maintenance Manager', 'Peacekeeping Operations Liaison', 'Defense Export Compliance Officer',
    'Military Training Exercise Planner', 'Base Housing Community Manager', 'Defense R&D Program Officer', 'Military Medical Readiness Coordinator',
    'Defense Budget Congressional Liaison', 'Military Justice Legal Assistance Advisor', 'Wounded Warrior Career Coach', 'Defense Supply Chain Security Manager',
    'NATO Allied Operations Coordinator', 'Military History Educator Museum Curator',
  ]);

  addBusiness('intelligence-national-security', 'Intelligence & National Security Analysis', 'forensic', [
    'All-Source Intelligence Analyst', 'Geospatial Intelligence Specialist', 'Signals Intelligence Analyst', 'Human Intelligence Operations Advisor',
    'Counterintelligence Investigator', 'Threat Assessment Fusion Center Analyst', 'Open Source Intelligence Researcher', 'Cyber Threat Intelligence Analyst',
    'Border Security Intelligence Coordinator', 'Sanctions Evasion Investigation Specialist', 'Intelligence Briefing Officer', 'National Security Policy Advisor',
    'Insider Threat Program Manager', 'Intelligence Collection Requirements Manager', 'Foreign Language Intelligence Linguist', 'Satellite Imagery Analyst',
    'Intelligence Ethics Oversight Advisor', 'Security Clearance Adjudication Specialist', 'Counterterrorism Analysis Coordinator', 'Economic Security Intelligence Analyst',
    'Intelligence Community IT Systems Manager', 'Declassification Records Review Specialist',
  ]);

  addBusiness('professional-sports-coaching', 'Professional Sports Coaching', 'sports', [
    'Head Coach Team Strategy Advisor', 'Assistant Coach Player Development Specialist', 'Strength & Conditioning Coach', 'Sports Performance Analyst',
    'Goalkeeper Specialist Coach', 'Pitching Coach Baseball Specialist', 'Offensive Coordinator Football Strategist', 'Scouting Director Talent Evaluator',
    'Athletic Trainer Team Healthcare Liaison', 'Sports Nutrition Team Dietitian', 'Video Analysis Coaching Technician', 'Youth Academy Development Coach',
    'Paralympic Adaptive Sports Coach', 'Esports Team Coach', 'Swim Coach Technique Specialist', 'Tennis Academy Head Pro',
    'Golf Teaching Professional', 'Martial Arts Dojo Head Instructor', 'Cheerleading Program Director', 'Rowing Crew Coach',
    'Sports Psychology Mental Performance Coach', 'Coach Education Certification Administrator',
  ]);

  addBusiness('fitness-gym-operations', 'Fitness Training & Gym Operations', 'sports', [
    'Personal Trainer Strength Specialist', 'Group Fitness Instructor', 'Gym General Manager', 'CrossFit Box Owner',
    'Yoga Studio Instructor', 'Pilates Reformer Instructor', 'Spin Cycling Instructor', 'Nutrition Coach Fitness Integration Specialist',
    'Physical Therapy Gym Bridge Program Manager', 'Corporate Wellness Fitness Coordinator', 'Athletic Club Membership Sales Manager', 'Fitness Equipment Maintenance Technician',
    'Online Fitness Program Creator', 'Senior Fitness Silver Sneakers Instructor', 'Youth Athletic Performance Trainer', 'Gym Floor Staff Operations Lead',
    'Fitness App Content Producer', 'Bodybuilding Competition Prep Coach', 'Climbing Gym Route Setter', 'Aquatic Fitness Instructor',
    'Fitness Franchise Operations Consultant', 'Gym Health Safety Compliance Officer',
  ]);

  // ─── Retail, Warehouse, Property ───────────────────────────────────────
  addBusiness('retail-store-merchandising', 'Retail Store Management & Merchandising', 'storefront', [
    'Retail Store Manager', 'Visual Merchandising Specialist', 'Category Manager Buyer', 'Loss Prevention Store Detective',
    'Retail Sales Associate Trainer', 'Inventory Control Store Specialist', 'Flagship Store Experience Manager', 'Omnichannel Retail Operations Lead',
    'Planogram Compliance Auditor', 'Retail District Manager', 'Pop-Up Shop Launch Manager', 'Luxury Retail Client Advisor',
    'Grocery Store Department Manager', 'Pharmacy Retail Store Manager', 'Big Box Retail Operations Director', 'Retail Analytics Foot Traffic Specialist',
    'Seasonal Holiday Retail Staffing Coordinator', 'Retail Returns & Exchanges Manager', 'Retail CRM Loyalty Program Manager', 'Retail Vendor Compliance Manager',
    'Retail Sustainability Packaging Advisor', 'Retail Technology POS Systems Manager',
  ]);

  addBusiness('wholesale-distribution', 'Wholesale & Distribution Sales', 'shipping', [
    'Wholesale Account Executive', 'Distribution Center Manager', 'Route Sales Driver Supervisor', 'Foodservice Distribution Buyer',
    'Industrial Wholesale Inside Sales Representative', 'Import Export Distribution Coordinator', 'Wholesale Pricing Analyst', 'Channel Partner Distribution Manager',
    'Cold Storage Distribution Operations Lead', 'Wholesale Catalog Merchandising Manager', 'B2B E-Commerce Wholesale Platform Manager', 'Distribution Fleet Manager',
    'Wholesale Credit Collections Manager', 'Trade Show Wholesale Sales Manager', 'Pharmaceutical Wholesale Compliance Officer', 'Agricultural Commodity Wholesale Broker',
    'Wholesale Returns & Recall Manager', 'Distribution Network Design Consultant', 'Wholesale Customer EDI Integration Specialist', 'Last-Mile Wholesale Delivery Coordinator',
    'Wholesale Inventory Turnover Analyst', 'Distribution Labor Workforce Planner',
  ]);

  addBusiness('warehouse-fulfillment-operations', 'Warehouse & Fulfillment Operations', 'factory', [
    'Warehouse Operations Manager', 'Forklift Operator Lead', 'Pick & Pack Fulfillment Supervisor', 'Automated Storage Retrieval Systems Technician',
    'Inventory Cycle Count Specialist', 'Warehouse Safety OSHA Compliance Officer', 'Cross-Dock Operations Coordinator', 'Reverse Logistics Warehouse Manager',
    'Cold Chain Warehouse Supervisor', 'Warehouse Labor Management System Analyst', 'Slotting Optimization Warehouse Engineer', '3PL Third Party Logistics Account Manager',
    'Warehouse Quality Assurance Inspector', 'Material Handler Team Lead', 'Warehouse Robotics Implementation Specialist', 'Bonded Warehouse Customs Compliance Manager',
    'E-Commerce Fulfillment SLA Manager', 'Warehouse Shift Scheduling Coordinator', 'Hazmat Warehouse Storage Specialist', 'Warehouse Continuous Improvement Lean Coach',
    'Dark Store Micro-Fulfillment Manager', 'Warehouse Disaster Recovery Planner',
  ]);

  addBusiness('property-management-leasing', 'Property Management & Leasing Operations', 'apartment', [
    'Residential Property Manager', 'Commercial Property Manager', 'HOA Community Association Manager', 'Leasing Agent Apartment Specialist',
    'Tenant Relations & Retention Manager', 'Property Maintenance Coordinator', 'Rent Collection & Delinquency Manager', 'Eviction Process Compliance Specialist',
    'Property Inspection Move-Out Manager', 'Affordable Housing Compliance Manager', 'Short-Term Rental Property Manager', 'Student Housing Operations Manager',
    'Industrial Property Facilities Manager', 'Property Management Software Administrator', 'CAM Common Area Maintenance Accountant', 'Property Marketing Listing Specialist',
    'Tenant Screening Background Check Specialist', 'Property Renovation Value-Add Project Manager', 'Multifamily Asset Manager', 'Property Management Franchise Owner',
    'Green Building Property Operations Manager', 'Property Management Customer Service Lead',
  ]);

  // ─── Culinary, Events, Hospitality ─────────────────────────────────────
  addService('culinary-arts-chef-roles', 'Culinary Arts & Chef Roles', 'restaurant', [
    'Executive Chef Restaurant', 'Sous Chef Line Management Specialist', 'Pastry Chef Bakery Specialist', 'Private Chef Personal Dining',
    'Catering Operations Chef', 'Food Truck Owner Operator', 'Banquet Chef Hotel Events', 'Sushi Chef Itamae Specialist',
    'Butcher Charcuterie Specialist', 'Menu Development Recipe Costing Chef', 'Culinary School Instructor', 'Restaurant Kitchen Manager',
    'Farm-to-Table Sourcing Chef', 'Vegan Plant-Based Chef Consultant', 'Cruise Ship Galley Chef', 'Institutional Foodservice Director',
    'Chef de Partie Station Specialist', 'Molecular Gastronomy R&D Chef', 'Chef Consultant Restaurant Opening', 'Culinary Competition Coach',
    'Chef Social Media Content Creator', 'Kitchen Food Safety HACCP Manager',
  ]);

  addService('bartending-beverage-service', 'Bartending & Beverage Service', 'restaurant', [
    'Head Bartender Mixologist', 'Sommelier Wine Service Specialist', 'Bar Manager Beverage Program Director', 'Craft Cocktail Developer',
    'Beer Cicerone Taproom Manager', 'Flair Bartending Entertainment Specialist', 'Non-Alcoholic Mocktail Program Designer', 'Beverage Cost Control Analyst',
    'Distillery Tour Tasting Room Manager', 'Brewery Production Tasting Room Lead', 'Barista Coffee Shop Manager', 'Tea Sommelier Specialty Beverage Advisor',
    'Nightclub VIP Bottle Service Manager', 'Hotel Lobby Bar Manager', 'Bartending School Instructor', 'Mobile Bar Event Catering Operator',
    'Beverage Distribution Sales Representative', 'Cocktail Menu Photography Stylist', 'Responsible Alcohol Service Trainer', 'Bar Inventory Par Level Manager',
    'Keg Line Cleaning Maintenance Technician', 'Beverage Sustainability Zero-Waste Advisor',
  ]);

  addService('event-planning-weddings', 'Event Planning & Wedding Coordination', 'groups', [
    'Wedding Planner Full Service Coordinator', 'Corporate Event Planner', 'Conference Trade Show Manager', 'Festival Production Manager',
    'Day-Of Wedding Coordinator', 'Event Venue Sales Manager', 'Catering Sales Event Specialist', 'Event Decor Floral Designer',
    'AV Production Event Technician', 'Event Budget & Contract Negotiator', 'Destination Wedding Planner', 'Nonprofit Gala Fundraising Event Manager',
    'Sports Tournament Event Operations Manager', 'Hybrid Virtual Event Producer', 'Event Risk & Insurance Advisor', 'Event Staffing & Volunteer Coordinator',
    'Experiential Marketing Event Designer', 'Event Sustainability Zero-Waste Planner', 'Entertainment Booking Agent Events', 'Event Registration Technology Manager',
    'Mitzvah Quinceañera Cultural Event Planner', 'Event Post-Analysis ROI Reporting Specialist',
  ]);

  // ─── Professional Support & Creative ───────────────────────────────────
  addBusiness('copywriting-content-production', 'Copywriting, Editing & Content Production', 'news', [
    'Copywriter Advertising Agency', 'Technical Writer Documentation Specialist', 'Content Strategist Editorial Calendar Manager', 'SEO Content Writer',
    'Grant Proposal Writer', 'Speechwriter Executive Communications', 'UX Writer Product Interface Specialist', 'Video Scriptwriter',
    'Medical Writer Pharmaceutical', 'Legal Brief Writer Paralegal Support', 'Ghostwriter Book Publishing', 'Email Marketing Copywriter',
    'Brand Voice Guidelines Editor', 'Substantive Book Editor', 'Proofreader Quality Assurance Specialist', 'Localization Transcreation Writer',
    'Podcast Show Notes Producer', 'Social Media Caption Copywriter', 'Annual Report Corporate Writer', 'Resume & LinkedIn Profile Writer',
    'Fact Checker Newsroom Specialist', 'Content Operations Workflow Manager',
  ]);

  addBusiness('market-research-consumer-insights', 'Market Research & Consumer Insights', 'analytics', [
    'Market Research Analyst', 'Focus Group Moderator', 'Survey Design Methodologist', 'Consumer Insights Brand Manager',
    'Consumer Market Competitive Intelligence Analyst', 'Ethnographic Field Researcher', 'Pricing Research Conjoint Analyst', 'Product Concept Testing Manager',
    'Social Listening Analytics Specialist', 'Retail Shopper Insights Manager', 'B2B Market Segmentation Analyst', 'Customer Journey Mapping Facilitator',
    'Brand Tracking Study Manager', 'Market Research Panel Operations Manager', 'Neuromarketing Research Advisor', 'International Market Entry Researcher',
    'Qualitative Coding Analysis Specialist', 'Syndicated Data Insights Analyst', 'Market Research Vendor Management Lead', 'Insight Storytelling Presentation Designer',
    'DIY Research Platform Product Manager', 'Market Research Ethics IRB Advisor',
  ]);

  addBusiness('executive-administrative-support', 'Executive & Administrative Support', 'work', [
    'Executive Assistant C-Suite', 'Office Manager Administrative Lead', 'Virtual Assistant Remote Operations Specialist', 'Board Meeting Coordinator',
    'Travel Arrangements Corporate Concierge', 'Calendar Management Chief of Staff Support', 'Administrative Business Partner', 'Reception Front Desk Manager',
    'Records Management Archivist Administrator', 'Meeting Minutes Corporate Secretary Support', 'Expense Report Processing Specialist', 'Event Logistics Administrative Coordinator',
    'Immigration Visa Administrative Specialist', 'Legal Administrative Assistant', 'Medical Practice Front Office Manager', 'Real Estate Closing Administrative Coordinator',
    'Church Parish Administrative Assistant', 'University Department Admin Coordinator', 'Bilingual Executive Assistant', 'Administrative Temp Agency Coordinator',
    'Workplace Move Relocation Project Assistant', 'Administrative Technology Tools Trainer',
  ]);

  addBusiness('call-center-contact-operations', 'Call Center & Contact Center Operations', 'support', [
    'Call Center Operations Manager', 'Customer Service Representative Team Lead', 'Technical Support Tier 2 Specialist', 'Outbound Telemarketing Sales Manager',
    'Contact Center Workforce Management Analyst', 'Quality Assurance Call Monitoring Specialist', 'IVR Phone Tree Systems Designer', 'Chat Support Digital Contact Agent Lead',
    'Contact Center CRM Administrator', 'Escalation Desk Supervisor', 'Multilingual Contact Center Team Lead', 'Collections Call Center Manager',
    'Healthcare Patient Access Call Center Specialist', 'Contact Center Training Onboarding Manager', 'Omnichannel Contact Strategy Director', 'Contact Center Real-Time Analyst',
    'Complaint Resolution Ombudsman Liaison', 'Contact Center Speech Analytics Manager', 'Remote Contact Center Technology Advisor', 'Contact Center BPO Vendor Manager',
    'Contact Center Employee Engagement Coach', 'Contact Center Disaster Recovery Planner',
  ]);

  addBusiness('notary-paralegal-legal-support', 'Notary, Paralegal & Legal Support', 'gavel', [
    'Litigation Paralegal', 'Corporate Paralegal Transaction Specialist', 'Immigration Paralegal Case Manager', 'Family Law Paralegal',
    'Notary Public Mobile Signing Agent', 'Court Filing E-Filing Specialist', 'Legal Secretary Law Firm', 'Discovery Document Review Project Manager',
    'Trademark Paralegal IP Specialist', 'Bankruptcy Petition Preparer Paralegal', 'Real Estate Closing Paralegal', 'Medical Malpractice Paralegal',
    'Legal Records Clerk', 'Trial Exhibit Preparation Specialist', 'Legal Billing Time Entry Specialist', 'Compliance Paralegal Regulatory Filings',
    'Legal Intake Client Screening Specialist', 'Subpoena Process Server Coordinator', 'Law Library Research Assistant', 'Legal Translation Document Specialist',
    'E-Discovery Forensic Collection Paralegal', 'Paralegal Professional Development Instructor',
  ]);

  addBusiness('tax-preparation-enrolled-agent', 'Tax Preparation & Enrolled Agent Services', 'balance', [
    'Tax Preparer Seasonal Specialist', 'Enrolled Agent IRS Representation', 'Corporate Tax Accountant', 'Sales Tax Compliance Specialist',
    'International Expat Tax Advisor', 'Estate Trust Tax Preparer', 'Tax Resolution Offer in Compromise Specialist', 'Property Tax Appeal Consultant',
    'Payroll Tax Compliance Manager', 'Nonprofit Tax Form 990 Preparer', 'Crypto Tax Reporting Specialist', 'State Local Tax Nexus Advisor',
    'Tax Software Implementation Trainer', 'IRS Audit Defense Representative', 'Transfer Pricing Documentation Specialist', 'R&D Tax Credit Analyst',
    'Tax Practice Marketing Client Acquisition Manager', 'Tax Office Franchise Owner', 'Bookkeeping Tax Integration Specialist', 'Tax Law Legislative Update Educator',
    'Voluntary Disclosure Program Advisor', 'Tax Ethics Professional Responsibility Coach',
  ]);

  addBusiness('payroll-benefits-hris', 'Payroll, Benefits & HRIS Administration', 'work', [
    'Payroll Processing Specialist', 'Benefits Enrollment Coordinator', 'HRIS System Administrator', 'Compensation Benchmarking Analyst',
    'Leave of Absence Administrator', 'Workers Compensation Claims HR Liaison', 'Payroll Tax Filing Compliance Manager', 'Employee Relations HR Generalist',
    'Open Enrollment Communications Manager', 'Garnishment Payroll Deduction Specialist', 'Global Payroll Multi-Country Coordinator', 'HR Shared Services Team Lead',
    'Time & Attendance Systems Manager', 'Benefits Broker Client Service Manager', 'COBRA Continuation Administrator', 'HR Compliance I-9 Audit Specialist',
    'Pay Equity Analysis HR Consultant', 'Employee Handbook Policy Writer', 'HR Help Desk Tier 1 Specialist', 'Payroll Year-End W-2 Specialist',
    'Benefits Analytics Cost Modeling Analyst', 'HRIS Integration API Project Manager',
  ]);

  // ─── Diplomacy, Research, Coaching ─────────────────────────────────────
  addBusiness('diplomacy-foreign-service', 'Diplomacy & Foreign Service', 'landmark', [
    'Foreign Service Officer Career Advisor', 'Diplomatic Protocol Officer', 'Consular Services Visa Officer', 'Trade Attaché Commercial Diplomacy Specialist',
    'Cultural Affairs Diplomatic Program Manager', 'Ambassador Speechwriter Communications Advisor', 'International Treaty Negotiation Support Officer', 'Embassy Security Cooperation Liaison',
    'Public Diplomacy Social Media Officer', 'Humanitarian Aid Diplomatic Coordinator', 'Sanctions Policy Diplomatic Advisor', 'UN Mission Delegate Liaison',
    'Peace Corps Program Country Director', 'International Development NGO Diplomatic Partner', 'Foreign Policy Think Tank Analyst', 'Diplomatic Courier Logistics Specialist',
    'Language Officer Diplomatic Interpreter', 'Economic Diplomacy Investment Promotion Officer', 'Crisis Evacuation Embassy Operations Manager', 'Diplomatic History Educator',
    'Track II Diplomacy Facilitator', 'Diplomatic Immunity Law Literacy Advisor',
  ]);

  addBusiness('anthropology-sociology-research', 'Anthropology, Sociology & Social Research', 'science', [
    'Cultural Anthropologist Field Researcher', 'Medical Anthropologist Health Systems Advisor', 'Urban Sociologist Community Researcher', 'Archival Ethnography Specialist',
    'Linguistic Anthropologist Documentation Researcher', 'Sociology Survey Research Director', 'Applied Anthropology UX Research Liaison', 'Forensic Anthropology Consultant',
    'Environmental Sociology Policy Researcher', 'Gender Studies Social Research Analyst', 'Migration Diaspora Sociology Researcher', 'Quantitative Sociology Statistician',
    'Participant Observation Field Methods Trainer', 'Community-Based Participatory Research Facilitator', 'Social Network Analysis Researcher', 'Policy Evaluation Sociology Consultant',
    'Visual Anthropology Documentary Producer', 'Economic Anthropology Market Systems Researcher', 'Criminology Sociology Research Analyst', 'Social Research Ethics IRB Advisor',
    'Anthropology Museum Exhibit Developer', 'Sociology Public Opinion Polling Director',
  ]);

  addBusiness('psychology-counseling-services', 'Psychology & Counseling (Non-Medical)', 'favorite', [
    'Licensed Professional Counselor', 'Marriage & Family Therapist', 'School Psychologist', 'Industrial Organizational Psychologist',
    'Substance Abuse Counselor LPC', 'Grief Counselor Bereavement Specialist', 'Career Counselor Vocational Advisor', 'Rehabilitation Counselor Disability Services',
    'Play Therapist Child Specialist', 'Couples Therapy Gottman Method Practitioner', 'EMDR Trauma Therapist', 'Neuropsychology Testing Technician',
    'Forensic Psychology Consultant', 'Health Psychology Behavior Change Coach', 'Sports Psychology Performance Counselor', 'Art Therapy Creative Arts Counselor',
    'Group Therapy Facilitator', 'Telehealth Counseling Platform Therapist', 'Counseling Supervision Clinical Director', 'Psychology Research Lab Coordinator',
    'Community Psychology Program Evaluator', 'Counseling Ethics Boundary Trainer',
  ]);

  addBusiness('life-coaching-career-development', 'Life Coaching & Career Development', 'work', [
    'Executive Leadership Coach', 'Career Transition Coach', 'Life Purpose Clarity Coach', 'Interview Preparation Coach',
    'Resume & Branding Career Strategist', 'Entrepreneurship Startup Coach', 'Retirement Life Planning Coach', 'Accountability Productivity Coach',
    'Couples Relationship Communication Coach', 'Financial Habits Life Coach', 'Wellness Holistic Life Coach', 'Academic Success College Coach',
    'Creative Block Artist Coach', 'Parenting Skills Coach', 'Divorce Transition Life Coach', 'Immigrant Career Integration Coach',
    'Neurodiversity Workplace Coach', 'Public Speaking Confidence Coach', 'Spiritual Life Direction Coach', 'Team Building Corporate Coach',
    'ICF Coaching Certification Mentor', 'Coaching Practice Business Development Advisor',
  ]);

  // ─── Home & Local Services ─────────────────────────────────────────────
  addService('pest-control-services', 'Pest Control & Extermination', 'home', [
    'Licensed Pest Control Technician', 'Termite Inspection Specialist', 'Bed Bug Heat Treatment Operator', 'Rodent Exclusion Specialist',
    'Mosquito Abatement Program Manager', 'Wildlife Removal Humane Specialist', 'Fumigation Safety Supervisor', 'Integrated Pest Management Consultant',
    'Commercial Kitchen Pest Control Specialist', 'Agricultural Crop Pest Advisor', 'Pest Control Route Manager', 'Termite Baiting System Installer',
    'Bee Wasp Removal Specialist', 'Pest Control Sales Inspector', 'Green Eco Pest Control Advisor', 'Stored Product Pest Grain Elevator Specialist',
    'Pest Control Franchise Owner', 'Pest Control Training Certification Instructor', 'Pest Identification Entomologist Liaison', 'HOA Community Pest Program Manager',
    'Pest Control Chemical Safety Compliance Officer', 'Pest Control Customer Retention Specialist',
  ]);

  addService('landscaping-garden-services', 'Landscaping, Lawn & Garden Services', 'eco', [
    'Landscape Designer Residential', 'Lawn Care Crew Supervisor', 'Arborist Tree Care Specialist', 'Irrigation Sprinkler Installer',
    'Hardscape Patio Builder', 'Landscape Maintenance Account Manager', 'Organic Lawn Care Specialist', 'Xeriscape Drought Landscape Designer',
    'Snow Removal Commercial Contractor', 'Garden Center Nursery Manager', 'Turf Installation Sod Specialist', 'Pond Water Feature Installer',
    'Landscape Lighting Designer', 'Commercial Groundskeeping Manager', 'Edible Garden Landscape Designer', 'Landscape Estimator Bid Specialist',
    'Pesticide Applicator Landscape License Holder', 'HOA Landscape Committee Consultant', 'Rooftop Green Roof Installer', 'Landscape Equipment Fleet Manager',
    'Pollinator Garden Design Specialist', 'Landscape Business Marketing Coach',
  ]);

  addService('locksmith-security-hardware', 'Locksmith & Security Hardware', 'construction', [
    'Residential Locksmith', 'Commercial Access Control Locksmith', 'Automotive Key Programming Locksmith', 'Safe Cracking Vault Technician',
    'Master Key System Designer', 'Electronic Lock Smart Home Installer', 'Locksmith Emergency 24-Hour Dispatcher', 'Door Hardware Specification Consultant',
    'High-Security Lock Pick Resistance Advisor', 'Forensic Locksmith Investigation Specialist', 'Locksmith Apprenticeship Instructor', 'Key Duplication Shop Manager',
    'Panic Bar Fire Exit Hardware Installer', 'Mailbox Lock Replacement Specialist', 'Gun Safe Installation Technician', 'Locksmith Supply Wholesale Representative',
    'Mobile Locksmith Fleet Owner', 'Locksmith Trade Association Compliance Advisor', 'Biometric Access Lock Installer', 'Padlock Industrial Security Specialist',
    'Locksmith Customer Security Audit Advisor', 'Locksmith Software Key Tracking Administrator',
  ]);

  addService('laundry-alterations-services', 'Laundry, Dry Cleaning & Alterations', 'home', [
    'Dry Cleaning Plant Manager', 'Tailor Alterations Specialist', 'Commercial Laundry Route Driver', 'Wedding Gown Preservation Specialist',
    'Leather Suede Cleaning Specialist', 'Uniform Rental Laundry Service Manager', 'Hotel Linen Laundry Operations Lead', 'Stain Removal Textile Chemist',
    'Seamstress Home Alterations Business Owner', 'Bespoke Suit Tailor', 'Embroidery Monogramming Specialist', 'Curtain Drapery Cleaning Installer',
    'Shoe Repair Cobbler', 'Leather Goods Repair Specialist', 'Laundromat Self-Service Owner', 'Healthcare Linen Infection Control Manager',
    'Dry Cleaning POS Customer Service Specialist', 'Alterations Fitting Appointment Coordinator', 'Eco-Friendly Wet Cleaning Advisor', 'Garment Textile Reuse Collection Manager',
    'Costume Wardrobe Maintenance Specialist', 'Laundry Equipment Maintenance Technician',
  ]);

  addService('jewelry-watchmaking-gemology', 'Jewelry, Watchmaking & Gemology', 'palette', [
    'Bench Jeweler Repair Specialist', 'Custom Engagement Ring Designer', 'Watchmaker Horologist Repair Specialist', 'GIA Graduate Gemologist Appraiser',
    'Jewelry Store Sales Consultant', 'Estate Jewelry Buyer', 'CAD Jewelry Design Specialist', 'Pearl Restringing Specialist',
    'Engraving Jewelry Personalization Artist', 'Jewelry Casting Production Manager', 'Luxury Watch Brand Authorized Dealer', 'Jewelry Appraisal Insurance Documentation Specialist',
    'Diamond Grading Lab Liaison', 'Jewelry Repair Shop Owner', 'Bead Jewelry Artisan Maker', 'Pawn Shop Jewelry Buyer',
    'Jewelry Trade Show Exhibitor Manager', 'Antique Jewelry Historian Authenticator', 'Jewelry Photography E-Commerce Specialist', 'Watch Battery Cell Replacement Technician',
    'Jewelry Loss Prevention Security Advisor', 'Sustainable Ethical Sourcing Jewelry Advisor',
  ]);

  // ─── Industrial Services & Design ──────────────────────────────────────
  addField('printing-signage-production', 'Printing, Signage & Large Format', 'factory', [
    'Offset Press Operator', 'Digital Print Production Manager', 'Wide Format Banner Installer', 'Screen Printing Apparel Production Lead',
    'Embossing Foil Stamping Specialist', 'Print Estimator Job Costing Specialist', 'Sign Fabrication Channel Letter Installer', 'Vehicle Wrap Graphics Installer',
    '3D Printing Prototyping Service Manager', 'Print Finishing Binding Specialist', 'Color Management Prepress Specialist', 'Label Printing Flexographic Operator',
    'Print Shop Customer Service Representative', 'Large Format UV Printer Operator', 'Neon Sign Restoration Specialist', 'Print-on-Demand Fulfillment Manager',
    'Sustainable Soy Ink Printing Advisor', 'Print MIS Workflow Software Administrator', 'Trade Show Booth Graphics Producer', 'Blueprint Architectural Printing Specialist',
    'Print Quality Control Inspector', 'Print Equipment Maintenance Technician',
  ]);

  addField('waste-management-recycling', 'Waste Management & Recycling', 'eco', [
    'Municipal Waste Collection Route Supervisor', 'Recycling Facility Sort Line Manager', 'Hazardous Waste Disposal Compliance Officer', 'Landfill Operations Manager',
    'Waste-to-Energy Plant Operator', 'Commercial Composting Program Manager', 'E-Waste Recycling Technician', 'Scrap Metal Recycling Yard Manager',
    'Medical Waste Biohazard Disposal Specialist', 'Construction Demolition Debris Recycler', 'Waste Audit Zero Waste Consultant', 'Recycling Education Outreach Coordinator',
    'Waste Brokerage Logistics Coordinator', 'Anaerobic Digestion Biogas Operator', 'Glass Recycling Processing Specialist', 'Textile Recycling Collection Manager',
    'Waste Collection Fleet Maintenance Manager', 'Extended Producer Responsibility Program Manager', 'Illegal Dumping Enforcement Investigator', 'Circular Economy Materials Recovery Advisor',
    'Waste Transfer Station Scale Operator', 'Waste Management RFP Contract Specialist',
  ]);

  addField('water-wastewater-treatment', 'Water & Wastewater Treatment', 'energy', [
    'Wastewater Treatment Plant Operator', 'Drinking Water Plant Operator', 'Water Quality Laboratory Technician', 'Stormwater Management Utility Engineer',
    'Pipe Network Leak Detection Specialist', 'Desalination Plant Operations Manager', 'Water Conservation Public Education Specialist', 'Industrial Pretreatment Compliance Inspector',
    'Biosolids Management Specialist', 'Water Utility Customer Service Manager', 'SCADA Water Systems Control Operator', 'Hydrant Flushing Maintenance Technician',
    'Cross-Connection Backflow Prevention Tester', 'Water Main Break Emergency Response Coordinator', 'PFAS Contaminant Treatment Specialist', 'Irrigation District Water Manager',
    'Dam Safety Inspection Liaison', 'Water Rights Allocation Advisor', 'Smart Meter AMI Water Deployment Manager', 'Wastewater Collections System CCTV Inspector',
    'Water Utility Capital Improvement Planner', 'Global WASH Development Program Advisor',
  ]);

  addField('elevator-building-systems-maintenance', 'Elevator & Building Systems Maintenance', 'construction', [
    'Elevator Mechanic Installer', 'Escalator Maintenance Technician', 'Building Automation Systems Technician', 'Fire Sprinkler Systems Inspector',
    'Commercial Generator Maintenance Technician', 'Boiler Chiller Plant Operator', 'Access Platform Lift Inspector', 'Dumbwaiter Service Technician',
    'Elevator Modernization Project Manager', 'ADA Compliance Building Systems Advisor', 'Building Envelope Commissioning Specialist', 'Parking Garage Ventilation Systems Technician',
    'Elevator Emergency Entrapment Responder Trainer', 'Conveyor Systems Maintenance Technician', 'Automatic Door Service Technician', 'Building Energy Management System Optimizer',
    'Elevator Code ASME A17 Compliance Inspector Liaison', 'Rope Traction Elevator Specialist', 'Hydraulic Elevator Repair Technician', 'Machine Room-Less Elevator Installer',
    'Elevator Service Route Dispatcher', 'Building Systems IoT Predictive Maintenance Analyst',
  ]);

  addField('crane-heavy-equipment-operation', 'Crane, Heavy Equipment & Rigging', 'construction', [
    'Tower Crane Operator', 'Mobile Crane Operator', 'Excavator Heavy Equipment Operator', 'Bulldozer Grading Operator',
    'Rigging Signal Person Specialist', 'Heavy Haul Truck Driver', 'Pile Driving Equipment Operator', 'Asphalt Paving Machine Operator',
    'Crane Lift Plan Engineer', 'Equipment Rental Yard Manager', 'Heavy Equipment Diesel Mechanic', 'OSHA Rigging Safety Trainer',
    'Tunnel Boring Machine Operator', 'Mining Heavy Equipment Operator', 'Crane Inspector Certification Specialist', 'Forklift Train-the-Trainer Instructor',
    'Pipeline Construction Equipment Operator', 'Demolition High Reach Excavator Operator', 'Crane Assembly Disassembly Supervisor', 'GPS Machine Control Grade Checker',
    'Heavy Equipment Telematics Fleet Manager', 'Crane Union Apprenticeship Coordinator',
  ]);

  addField('land-surveying-geomatics', 'Land Surveying & Geomatics', 'construction', [
    'Licensed Land Surveyor', 'Construction Staking Survey Technician', 'Boundary Dispute Survey Specialist', 'ALTA NSPS Survey Coordinator',
    'Hydrographic Surveyor', 'Drone LiDAR Survey Pilot', 'GIS Cadastral Mapping Specialist', 'Mine Surveying Engineer',
    'Forensic Accident Scene Surveyor', 'Subdivision Platting Survey Manager', 'Survey Crew Chief', 'Geodetic Control Network Specialist',
    'Right-of-Way Acquisition Survey Liaison', 'As-Built Survey Building Documentation Specialist', 'Survey Instrument Calibration Technician', 'Bathymetric Mapping Specialist',
    'Survey Data CAD Drafting Technician', 'Land Title Survey Insurance Advisor', 'Utility Locating GPR Survey Technician', 'Survey Business Development Manager',
    'Survey Ethics Boundary Law Educator', 'Survey Robotics Total Station Trainer',
  ]);

  addBusiness('architecture-built-environment', 'Architecture & Built Environment Design', 'apartment', [
    'Licensed Architect Project Lead', 'Interior Design Residential Specialist', 'Landscape Architect Licensed', 'Urban Design Master Planner',
    'Historic Preservation Architect', 'Healthcare Facility Design Architect', 'Sustainable LEED Architect', 'BIM Building Information Modeling Manager',
    'Architectural Drafter CAD Technician', 'Set Design Architect Entertainment', 'Architectural Specification Writer', 'Code Compliance Plan Review Architect',
    'Architectural Visualization 3D Renderer', 'Architectural Photographer Documentation Specialist', 'Architectural Project Manager Construction Admin', 'Accessible Design Universal Architect',
    'Architectural Fee Proposal Consultant', 'Architectural Intern Licensing Advisor', 'Modular Prefab Design Architect', 'Coastal Resilience Architecture Specialist',
    'Architectural Forensics Building Failure Analyst', 'Architect-Client Programming Workshop Facilitator',
  ]);

  addBusiness('industrial-product-design', 'Industrial & Product Design', 'palette', [
    'Industrial Product Designer', 'Consumer Electronics Product Designer', 'Furniture Product Design Specialist', 'Packaging Structural Designer',
    'Medical Device Product Designer', 'Automotive Interior Product Designer', 'Toy Product Design Developer', 'Sustainable Materials Product Designer',
    'Design for Manufacturing DFM Specialist', 'Rapid Prototyping 3D Design Engineer', 'Ergonomics Human Factors Product Designer', 'CMF Color Material Finish Designer',
    'Design Patent Portfolio Strategist', 'Crowdfunding Product Launch Designer', 'Kitchen Appliance Product Designer', 'Wearable Technology Product Designer',
    'Design Thinking Workshop Facilitator', 'Product Design Design Sprint Lead', 'Inclusive Design Accessibility Product Specialist', 'Design Portfolio Review Career Coach',
    'Open Source Hardware Product Designer', 'Product Design Agency Creative Director',
  ]);

  addBusiness('ux-research-human-centered-design', 'UX Research & Human-Centered Design', 'web', [
    'UX Researcher Qualitative Specialist', 'Usability Testing Lab Manager', 'User Interview Research Facilitator', 'Card Sorting Information Architecture Researcher',
    'Diary Study Longitudinal UX Researcher', 'A/B Testing Experimentation UX Analyst', 'Accessibility UX Research Specialist', 'Service Design Journey Mapper',
    'Ethnographic UX Field Researcher', 'UX Metrics HEART Framework Analyst', 'Design Ops Research Repository Manager', 'UX Research Recruitment Panel Manager',
    'Benchmark Competitive UX Audit Specialist', 'Prototype Usability Testing Moderator', 'UX Research Ethics Consent Advisor', 'International UX Localization Researcher',
    'Voice UI Conversation Design Researcher', 'AR VR Immersive UX Researcher', 'UX Research Stakeholder Storytelling Presenter', 'Research Ops Tooling Administrator',
    'Mixed Methods UX Research Director', 'UX Research Career Portfolio Coach',
  ]);

  addBusiness('lobbying-government-affairs', 'Lobbying & Government Affairs', 'landmark', [
    'Federal Lobbyist Government Affairs Director', 'State Capitol Lobbyist', 'Grassroots Advocacy Campaign Manager', 'PAC Political Action Committee Manager',
    'Legislative Tracking Policy Analyst', 'Regulatory Comment Letter Drafter', 'Trade Association Government Relations VP', 'Corporate Public Affairs Director',
    'Lobbying Disclosure Compliance Filing Specialist', 'Coalition Building Advocacy Strategist', 'Ballot Initiative Campaign Director', 'Government Procurement Lobbying Specialist',
    'Energy Policy Lobbyist', 'Healthcare Policy Lobbyist', 'Tech Platform Policy Government Relations Manager', 'Defense Appropriations Lobbying Advisor',
    'Municipal Local Government Affairs Specialist', 'International Government Relations Advisor', 'Lobbying Ethics Training Facilitator', 'Advocacy Digital Campaign Manager',
    'Think Tank Policy Outreach Director', 'Lobbying Client Development Business Development Manager',
  ]);

  addBusiness('grant-writing-proposal-development', 'Grant Writing & Proposal Development', 'volunteer', [
    'Federal Grant Writer NIH NSF Specialist', 'Foundation Grant Proposal Writer', 'SBIR STTR Grant Proposal Consultant', 'Grant Budget Development Specialist',
    'Grant Compliance Reporting Manager', 'RFP Response Proposal Manager', 'Grant Research Prospect Identification Specialist', 'Grant Review Panel Mock Reviewer Coach',
    'Grant Program Evaluation Impact Report Writer', 'Grant Calendar Pipeline Manager', 'Corporate Sponsorship Proposal Writer', 'Grant Writing Workshop Instructor',
    'Grant Management Systems Administrator', 'Grant Subrecipient Monitoring Compliance Specialist', 'Arts Council Grant Application Specialist', 'Education Department Grant Writer',
    'International Development Grant Proposal Writer', 'Grant Logic Model Theory of Change Facilitator', 'Grant Writing Freelance Agency Owner', 'Grant Renewal Continuation Specialist',
    'Grant Ethics Conflict of Interest Advisor', 'Grant Writing AI-Assisted Workflow Consultant',
  ]);

  addBusiness('small-business-entrepreneurship', 'Small Business Ownership & Entrepreneurship', 'storefront', [
    'Main Street Retail Business Owner', 'Restaurant Startup Entrepreneur', 'E-Commerce Solo Founder', 'Franchisee Multi-Unit Operator',
    'Food Truck Entrepreneur', 'Consulting Practice Solo Founder', 'SaaS Bootstrap Startup Founder', 'Family Business Succession Planner',
    'Side Hustle to Full-Time Transition Coach', 'Business Plan SBA Loan Advisor', 'Coworking Space Community Manager', 'Maker Space Workshop Owner',
    'Import Export Small Business Trader', 'Home-Based Business Compliance Advisor', 'Pop-Up Retail Entrepreneur', 'Subscription Box Business Founder',
    'Social Enterprise B-Corp Founder', 'Business Exit Strategy Seller Advisor', 'Small Business Bookkeeper DIY Coach', 'Local SEO Small Business Marketer',
    'Chamber of Commerce Small Business Liaison', 'Entrepreneur Pitch Competition Coach',
  ]);

  addService('home-inspection-appraisal', 'Home Inspection & Real Estate Appraisal', 'apartment', [
    'Licensed Home Inspector', 'Commercial Building Inspector', 'Mold Inspection Specialist', 'Radon Testing Inspector',
    'Pool Spa Inspection Specialist', 'New Construction Phase Inspection Specialist', 'Home Appraisal Process Educator', 'Commercial Building Appraisal Liaison',
    'FHA VA Appraisal Specialist', 'Home Inspection Report Writing Software Trainer', 'Wind Mitigation Inspection Specialist', 'Thermal Imaging Home Inspector',
    'Home Inspection Business Marketing Coach', 'Appraisal Review UMP Compliance Specialist', 'Historic Home Inspection Specialist', 'Mobile Home Inspection Specialist',
    'Home Inspector Continuing Education Instructor', 'Appraisal Litigation Expert Witness', 'Drone Roof Inspection Specialist', 'Home Inspection Franchise Owner',
    'Pre-Listing Seller Inspection Advisor', 'Appraisal Management Company Coordinator',
  ]);

  addBusiness('mediation-dispute-resolution', 'Mediation & Alternative Dispute Resolution', 'gavel', [
    'Certified Civil Mediator', 'Family Divorce Mediator', 'Workplace Conflict Mediator', 'Community Dispute Resolution Center Director',
    'Arbitration Case Administrator', 'Restorative Justice Circle Facilitator', 'Construction Dispute Mediator', 'International Commercial Arbitration Specialist',
    'Online Dispute Resolution Platform Mediator', 'Peer Mediation School Program Trainer', 'Elder Care Family Mediator', 'Landlord Tenant Dispute Mediator',
    'Medical Malpractice Mediation Neutral', 'Employment EEO Mediation Specialist', 'HOA Neighborhood Dispute Mediator', 'Mediator Ethics Standards Trainer',
    'Conflict Coaching Pre-Mediation Specialist', 'Multi-Party Complex Mediation Facilitator', 'Mediation Marketing Practice Development Coach', 'Court-Annexed Mediation Program Coordinator',
    'Cross-Cultural International Mediator', 'Mediation Settlement Agreement Drafter',
  ]);

  addBusiness('nursing-home-longterm-care', 'Nursing Home & Long-Term Care Administration', 'hospital', [
    'Nursing Home Administrator Licensed', 'Assisted Living Executive Director', 'Memory Care Program Director', 'Skilled Nursing MDS Coordinator',
    'Long-Term Care Survey Compliance Specialist', 'Nursing Home Admissions Marketing Director', 'Rehabilitation SNF Therapy Coordinator', 'Long-Term Care Dietary Services Manager',
    'Nursing Home Activities Life Enrichment Director', 'Infection Control LTC Nurse Consultant', 'Hospice Inpatient Unit Administrator', 'Adult Day Care Program Director',
    'Continuing Care Retirement Community Executive', 'Long-Term Care Quality Improvement Nurse', 'Nursing Home Social Services Director', 'LTC Pharmacy Consultant Pharmacist Liaison',
    'Nursing Home Staffing Scheduler', 'Long-Term Care Ombudsman Liaison Educator', 'Nursing Home Capital Renovation Project Manager', 'LTC Electronic Health Records Trainer',
    'Nursing Home Family Council Facilitator', 'Long-Term Care Reimbursement Medicare Billing Specialist',
  ]);

  addBusiness('home-health-hospice-operations', 'Home Health & Hospice Care Operations', 'hospital', [
    'Home Health Agency Director', 'Hospice Executive Director', 'Home Health Clinical Manager RN', 'Hospice Intake Referral Coordinator',
    'Home Health Scheduling Field Staff Manager', 'Hospice Bereavement Program Manager', 'Home Health OASIS Documentation QA Specialist', 'Hospice Volunteer Coordinator',
    'Home Health Medicare Certification Survey Prep Advisor', 'Palliative Home Visit Nurse Manager', 'Home Health Aide Training Supervisor', 'Hospice Interdisciplinary Team Facilitator',
    'Home Infusion Nursing Program Manager', 'Hospice Inpatient Unit Nurse Manager', 'Home Health Telemonitoring RPM Program Manager', 'Hospice Chaplaincy Program Director',
    'Home Health Billing Revenue Cycle Manager', 'Hospice Pharmacy Comfort Kit Manager', 'Home Health Pediatric Program Director', 'Hospice Pediatric Program Coordinator',
    'Home Health Rural Access Program Developer', 'Hospice Equity Access Community Outreach Manager',
  ]);

  addBusiness('real-estate-appraisal-valuation', 'Real Estate Appraisal & Valuation', 'apartment', [
    'Residential Real Estate Appraiser', 'Commercial Income Property Appraiser', 'Agricultural Land Appraiser', 'Personal Property Machinery Appraiser',
    'Business Valuation Analyst', 'Intangible Asset Valuation Specialist', 'Eminent Domain Appraisal Litigation Expert', 'Assessment Tax Appeal Consultant',
    'Appraisal Review AMC Compliance Analyst', 'Real Estate Market Analysis Researcher', 'Cost Approach Depreciation Specialist', 'Highest Best Use Analysis Consultant',
    'Green Building Valuation LEED Appraiser', 'Data Center Specialty Property Appraiser', 'Hotel Hospitality Appraisal Specialist', 'Appraisal Standards USPAP Instructor',
    'Automated Valuation Model AVM Analyst', 'Portfolio Valuation REIT Analyst', 'Mineral Rights Oil Gas Appraiser', 'Appraisal Practice Business Development Manager',
    'Cross-Border International Property Valuer', 'Appraisal Technology Platform Product Manager',
  ]);

  addBusiness('insurance-claims-adjusting', 'Insurance Claims Adjusting & Underwriting', 'policy', [
    'Property Casualty Claims Adjuster', 'Auto Physical Damage Claims Appraiser', 'Catastrophe CAT Claims Field Adjuster', 'Workers Compensation Claims Examiner',
    'Life Insurance Underwriter', 'Health Insurance Underwriter', 'Commercial Lines Underwriter', 'Reinsurance Treaty Underwriter',
    'Subrogation Recovery Claims Specialist', 'Fraud Investigation SIU Analyst', 'Claims Litigation Management Specialist', 'Public Adjuster Policyholder Advocate',
    'Crop Insurance Claims Adjuster', 'Marine Cargo Claims Surveyor', 'Aviation Insurance Claims Specialist', 'Cyber Insurance Claims Incident Manager',
    'Claims Call Center Team Lead', 'Insurance Premium Audit Specialist', 'Surety Bond Underwriter', 'Insurance Risk Engineering Field Surveyor',
    'Claims Data Analytics Predictive Modeling Analyst', 'Insurance Product Filing Regulatory Specialist',
  ]);

  addBusiness('court-reporting-litigation-support', 'Court Reporting & Litigation Support', 'gavel', [
    'Certified Court Reporter Stenographer', 'Legal Videographer Deposition Specialist', 'Trial Presentation Technology Specialist', 'Litigation Support Project Manager',
    'Realtime Court Reporting CART Provider', 'Deposition Scheduling Coordinator', 'Electronic Court Filing Clerk', 'Trial Exhibit Binder Production Specialist',
    'Mock Trial Jury Consultant', 'Legal Graphics Trial Consultant', 'Court Interpreter Certified Specialist', 'Transcript Proofreader Scopist',
    'Remote Deposition Zoom Platform Operator', 'Court Reporter Agency Owner', 'Legal Animation Accident Reconstruction Producer', 'Trial Technology Hot Seat Operator',
    'Arbitration Hearing Reporter', 'Legal Records Trial Notebook Specialist', 'Court Reporting Continuing Education Instructor', 'Litigation Support E-Discovery Vendor Manager',
    'Voice Writing Court Reporter', 'Court Reporting Captioning Broadcast Specialist',
  ]);

  addBusiness('broadcast-journalism-newsroom', 'Broadcast Journalism & Newsroom', 'news', [
    'TV News Anchor Career Coach', 'Investigative Journalism Producer', 'Radio News Director', 'Podcast News Executive Producer',
    'Field Reporter Multimedia Journalist', 'News Assignment Desk Editor', 'Broadcast Meteorologist', 'Sports Broadcast Journalist',
    'Newsroom Fact-Checking Editor', 'Engagement Audience Editor Digital News', 'Photojournalist News Photographer', 'News Graphics Motion Designer',
    'OB Van Live Broadcast Engineer', 'News Teleprompter Operator', 'Community Affairs Broadcast Producer', 'News Ethics Standards Editor',
    'War Correspondent Safety Trainer', 'Local News Startup Founder', 'Newsletter Journalism Substack Publisher', 'Data Journalism Interactive News Developer',
    'Newsroom Diversity Inclusion Editor', 'Broadcast FCC Compliance Advisor',
  ]);

  addBusiness('fine-arts-crafts-artisan', 'Fine Arts, Crafts & Artisan Work', 'brush', [
    'Oil Painter Fine Artist', 'Sculptor Public Art Commission Specialist', 'Ceramic Potter Studio Owner', 'Glass Blowing Artisan',
    'Woodworker Fine Furniture Maker', 'Textile Weaver Fiber Artist', 'Printmaker Edition Publisher', 'Illustrator Editorial Artist',
    'Street Mural Public Art Artist', 'Art Gallery Owner Curator', 'Art Fair Booth Sales Manager', 'Etsy Handmade Shop Owner',
    'Calligraphy Lettering Artist', 'Leather Craft Artisan Maker', 'Jewelry Metalsmith Artisan', 'Paper Craft Bookbinding Artist',
    'Art Conservation Restoration Specialist', 'Art Appraisal Authentication Specialist', 'Artist Residency Program Director', 'Art Studio Lease Collective Manager',
    'Art Therapy Studio Facilitator', 'Artisan Market Festival Organizer',
  ]);

  addBusiness('diplomatic-courier-logistics', 'International Trade & Customs Brokerage', 'shipping', [
    'Licensed Customs Broker', 'Import Compliance Classification Specialist', 'Export Control EAR ITAR Compliance Officer', 'Freight Forwarder Operations Manager',
    'International Trade Compliance Analyst', 'Drawback Duty Recovery Specialist', 'Foreign Trade Zone Administrator', 'Certificate of Origin Trade Documentation Specialist',
    'Anti-Dumping Countervailing Duty Analyst', 'Global Trade Management Software Administrator', 'Cross-Border E-Commerce Logistics Manager', 'Incoterms Trade Terms Educator',
    'Customs Bond Surety Specialist', 'Trade Sanctions Denied Party Screening Analyst', 'Free Trade Agreement Qualification Specialist', 'Importer of Record IOR Services Manager',
    'Trade Compliance Audit Consultant', 'International Shipping Documentation Specialist', 'Port Customs Exam Coordination Specialist', 'Trade Policy Tariff Impact Analyst',
    'AEO Authorized Economic Operator Program Advisor', 'Trade Finance Letter of Credit Specialist',
  ]);

  return defs;
}
