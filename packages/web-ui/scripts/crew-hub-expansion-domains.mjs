/**
 * Additional Crew Hub sectors — merged into generate-crew-hub.mjs
 * Each category must have >= 20 role templates (enforced by generator).
 */

function role(title, specialty, name, tone) {
  return { title, specialty, name, tone };
}

function rolesFromTitles(categoryLabel, titles, specialtyPrefix) {
  return titles.map((title) => ({
    title,
    specialty: `${specialtyPrefix} for ${title.toLowerCase()} — planning, education, and operational guidance`,
  }));
}

const medicalTraits = ['ethical', 'empathetic', 'evidence-minded', 'patient-focused', 'clear', 'cautious'];
const scienceTraits = ['analytical', 'curious', 'methodical', 'rigorous', 'collaborative', 'precise'];
const fieldTraits = ['practical', 'hands-on', 'safety-conscious', 'detail-oriented', 'patient', 'resourceful'];
const govTraits = ['procedural', 'impartial', 'policy-aware', 'thorough', 'communicative', 'accountable'];

/** @returns {import('./generate-crew-hub.mjs').CategoryDef[]} */
export function expansionCategoryDefinitions() {
  const defs = [];

  const addMedical = (id, label, titles) => {
    defs.push({
      id,
      label,
      iconId: 'local_hospital',
      medicalCategory: true,
      skillBank: ['Clinical Literacy', 'Care Pathways', 'Patient Education', 'Medical Terminology', 'Evidence Review', 'Care Coordination', 'Health Literacy', 'Risk Communication', 'Preventive Health', 'Chronic Disease Support', 'Referral Navigation', 'Documentation'],
      traitBank: medicalTraits,
      roles: rolesFromTitles(label, titles, 'informational health education and care navigation'),
    });
  };

  addMedical('medical-primary-care', 'Medical · Primary Care', [
    'Family Medicine Advisor', 'General Practice Educator', 'Preventive Care Coach', 'Adult Wellness Navigator',
    'Geriatric Primary Care Guide', 'Adolescent Health Educator', 'Travel Medicine Advisor', 'Occupational Health Screener',
    'Vaccination Education Specialist', 'Chronic Care Panel Manager', 'Hypertension Education Coach', 'Diabetes Lifestyle Educator',
    'Asthma Action Plan Advisor', 'Smoking Cessation Coach', 'Weight Management Counselor', 'Sleep Health Educator',
    'Men\'s Health Advisor', 'Women\'s Health Primary Advisor', 'Palliative Primary Care Navigator', 'Rural Primary Care Planner',
    'Telehealth Primary Care Coach', 'Health Screening Scheduler',
  ]);

  addMedical('medical-internal-medicine', 'Medical · Internal Medicine', [
    'Internal Medicine Hospitalist Advisor', 'General Internist Educator', 'Hospital Medicine Flow Coach',
    'Anticoagulation Education Advisor', 'Fever Workup Literacy Guide', 'Polypharmacy Review Educator',
    'Metabolic Syndrome Coach', 'Internal Medicine Board Prep Tutor', 'Multimorbidity Care Coordinator',
    'Complex Chronic Disease Navigator', 'Hospital Discharge Planning Educator', 'Medicine Consult Communication Coach',
    'Preoperative Medical Clearance Educator', 'Adult Immunization Schedule Advisor', 'Travel Medicine Chronic Disease Coach',
    'Hospital Antibiotic Stewardship Educator', 'Internal Medicine Quality Improvement Coach', 'Medicine Ward Rounds Family Educator',
    'Inpatient Glycemic Management Coach', 'Delirium Prevention Hospital Advisor', 'Hospital Falls Prevention Educator',
    'Internal Medicine Telehealth Coach',
  ]);

  addMedical('medical-surgical-specialties', 'Medical · Surgical Specialties (General)', [
    'General Surgery Prehab Advisor', 'Surgical Consent Literacy Advisor', 'Post-Op Wound Care Educator',
    'Surgical Scheduling Coordinator', 'Minimally Invasive Surgery Educator', 'Robotic Surgery Patient Guide',
    'Surgical Site Infection Prevention Coach', 'Same-Day Surgery Discharge Coach', 'Surgical Risk Stratification Educator',
    'Perioperative Blood Management Advisor', 'Surgical Antibiotic Prophylaxis Educator', 'Surgical Pain Expectation Coach',
    'Surgical Second Opinion Navigator', 'Surgical Clinical Trial Educator', 'Surgical Quality Outcomes Advisor',
    'Surgical Team Communication Educator', 'Outpatient Surgery Center Navigator', 'Surgical Complication Red Flag Educator',
    'Surgical Nutrition Prehab Coach', 'Surgical DVT Prevention Educator', 'Surgical Scar Management Advisor',
    'Surgical Telehealth Follow-Up Coach',
  ]);

  addMedical('medical-pediatrics-neonatal', 'Medical · Pediatrics & Neonatal', [
    'Pediatric Well-Child Educator', 'Neonatal ICU Family Navigator', 'Pediatric Asthma Coach', 'Childhood Nutrition Advisor',
    'Adolescent Medicine Counselor', 'Pediatric Emergency Triage Educator', 'Developmental Milestone Guide', 'Vaccine Hesitancy Counselor',
    'Pediatric Diabetes Educator', 'NICU Discharge Planner', 'Breastfeeding Lactation Educator', 'Pediatric Sleep Coach',
    'Childhood Obesity Prevention Advisor', 'Pediatric Allergy Educator', 'School Health Policy Advisor', 'Pediatric Mental Health First Aid Coach',
    'Newborn Care Skills Educator', 'Pediatric Pain Management Literacy Guide', 'Youth Sports Safety Advisor', 'Neonatal Pediatric Palliative Navigator',
    'Child Abuse Recognition Trainer', 'Pediatric Telehealth Coach',
  ]);

  addMedical('medical-obstetrics-gynecology', 'Medical · OB/GYN & Reproductive Health', [
    'Prenatal Education Specialist', 'Labor & Delivery Birth Plan Coach', 'Postpartum Recovery Advisor', 'Lactation Support Educator',
    'Fertility Awareness Educator', 'Menopause Symptom Coach', 'PCOS Lifestyle Advisor', 'Endometriosis Support Navigator',
    'Cervical Screening Literacy Guide', 'Contraception Options Counselor', 'High-Risk Pregnancy Navigator', 'Pelvic Floor Rehab Educator',
    'Pregnancy Nutrition Coach', 'Gestational Diabetes Educator', 'Miscarriage Support Counselor', 'Reproductive Endocrinology Educator',
    'OB Triage Phone Coach', 'Prenatal Genetic Screening Educator', 'Postpartum Mental Health Navigator', 'Gynecologic Surgery Recovery Advisor',
    'Sexual Health Educator', 'Midwifery Care Pathway Advisor',
  ]);

  addMedical('medical-psychiatry-behavioral', 'Medical · Psychiatry & Behavioral Health', [
    'Depression Psychoeducation Coach', 'Anxiety Coping Skills Educator', 'Bipolar Mood Tracking Advisor', 'PTSD Grounding Skills Coach',
    'ADHD Executive Function Coach', 'Addiction Recovery Navigator', 'Eating Disorder Support Educator', 'Schizophrenia Family Psychoeducation Guide',
    'Suicide Crisis Resource Navigator', 'Child Psychiatry Parent Coach', 'Geriatric Psychiatry Support Advisor', 'Sleep Psychiatry Hygiene Coach',
    'OCD Exposure Planning Educator', 'Personality Disorder DBT Skills Coach', 'Substance Use Harm Reduction Educator', 'Therapy Modality Explainer',
    'Psychiatric Medication Literacy Advisor', 'Inpatient Psychiatry Discharge Planner', 'Community Mental Health Navigator', 'Workplace Mental Health Advisor',
    'Trauma-Informed Care Coach', 'Behavioral Health Integration Advisor',
  ]);

  addMedical('medical-radiology-imaging', 'Medical · Radiology & Imaging', [
    'MRI Preparation Educator', 'CT Scan Safety Advisor', 'Ultrasound Exam Explainer', 'Mammography Screening Coach',
    'PET Scan Literacy Guide', 'Interventional Radiology Prep Advisor', 'Radiation Dose Awareness Educator', 'Pediatric Imaging Sedation Coach',
    'Contrast Allergy Screening Educator', 'Pregnancy Imaging Safety Advisor', 'X-Ray Result Literacy Coach', 'Nuclear Medicine Tracer Educator',
    'Breast Imaging Navigator', 'Musculoskeletal Imaging Explainer', 'Neuroradiology Report Literacy Coach', 'Cardiac Imaging Educator',
    'Image-Guided Biopsy Prep Advisor', 'Radiology Scheduling Flow Coach', 'Teleradiology Patient Communication Advisor', 'Imaging Cost Transparency Guide',
    'Orthopedic Imaging Explainer', 'Emergency Radiology Triage Educator',
  ]);

  addMedical('medical-pathology-laboratory', 'Medical · Pathology & Laboratory', [
    'Clinical Lab Test Explainer', 'Blood Panel Literacy Coach', 'Microbiology Culture Educator', 'Histopathology Report Guide',
    'Molecular Diagnostics Educator', 'Point-of-Care Testing Advisor', 'Lab Quality Assurance Coach', 'Phlebotomy Patient Comfort Educator',
    'Toxicology Screen Explainer', 'Genetic Test Result Navigator', 'Coagulation Panel Educator', 'Urinalysis Literacy Coach',
    'Lab Reference Range Educator', 'Critical Value Communication Advisor', 'Lab Logistics & Turnaround Coach', 'Biobank Consent Educator',
    'Cytology Screening Advisor', 'Allergy Testing Interpretation Coach', 'Hormone Panel Literacy Guide', 'Infectious Serology Educator',
    'Lab Automation Workflow Advisor', 'Patient Home Test Kit Educator',
  ]);

  addMedical('medical-emergency-critical-care', 'Medical · Emergency & Critical Care', [
    'Emergency Department Triage Literacy Educator', 'CPR & First Aid Training Coach', 'Stroke FAST Awareness Educator', 'Cardiac Arrest Bystander Coach',
    'Sepsis Early Warning Educator', 'Trauma First Response Advisor', 'Poison Control Resource Navigator', 'ICU Family Communication Coach',
    'Ventilator Literacy Educator', 'Shock Recognition Trainer', 'Anaphylaxis Action Plan Advisor', 'Burn First Aid Educator',
    'Disaster Triage Tabletop Facilitator', 'Emergency Medication Literacy Coach', 'Critical Care Rounding Family Advisor', 'ECMO Family Educator',
    'Airway Management Skills Trainer', 'Mass Casualty Incident Planner', 'Emergency Pediatrics Parent Coach', 'Rapid Response Team Educator',
    'Post-ICU Syndrome Recovery Advisor', 'Emergency Telemedicine Triage Coach',
  ]);

  addMedical('medical-dental-oral-health', 'Medical · Dental & Oral Health', [
    'Preventive Dentistry Educator', 'Orthodontics Expectation Coach', 'Periodontal Disease Literacy Advisor', 'Oral Surgery Recovery Guide',
    'Pediatric Dental Anxiety Coach', 'Endodontics Procedure Explainer', 'Prosthodontics Options Educator', 'Dental Implant Journey Advisor',
    'Fluoride & Sealant Educator', 'TMJ Pain Self-Care Coach', 'Oral Cancer Screening Literacy Guide', 'Dental Emergency First Aid Advisor',
    'Orthodontic Retainer Care Coach', 'Dental Radiograph Safety Educator', 'Gum Disease Home Care Advisor', 'Dental Sedation Prep Coach',
    'Community Dental Access Navigator', 'Dental Insurance Benefits Educator', 'Halitosis & Oral Hygiene Coach', 'Sports Mouthguard Advisor',
    'Cleft Palate Care Pathway Educator', 'Geriatric Dental Care Advisor',
  ]);

  addMedical('medical-pharmacy-pharmacology', 'Medical · Pharmacy & Pharmacology', [
    'Medication Adherence Coach', 'Drug Interaction Awareness Educator', 'Generic vs Brand Literacy Advisor', 'Pediatric Dosing Safety Educator',
    'Geriatric Polypharmacy Review Coach', 'OTC Medication Safety Advisor', 'Antibiotic Stewardship Educator', 'Insulin Storage & Use Coach',
    'Chemotherapy Oral Medication Educator', 'Compounding Pharmacy Explainer', 'Pharmacogenomics Literacy Advisor', 'Vaccine Storage Cold Chain Coach',
    'Controlled Substance Safety Educator', 'Medication Reconciliation Advisor', 'Hospital Pharmacy Workflow Coach', 'Specialty Pharmacy Navigator',
    'Herb-Drug Interaction Educator', 'Medication Cost Assistance Navigator', 'Inhaler Technique Coach', 'Topical Medication Application Educator',
    'Biosimilar Education Specialist', 'Pharmacy Benefit Literacy Advisor',
  ]);

  addMedical('medical-nursing-allied-health', 'Medical · Nursing & Allied Health', [
    'Registered Nurse Care Plan Educator', 'Licensed Practical Nurse Skills Coach', 'Nurse Practitioner Scope Explainer', 'Clinical Nurse Specialist Advisor',
    'Medical Assistant Workflow Coach', 'Certified Nursing Assistant Trainer', 'Wound Care Nursing Educator', 'IV Therapy Skills Advisor',
    'Home Health Nursing Navigator', 'School Nurse Policy Advisor', 'Nurse Manager Staffing Coach', 'Perioperative Nursing Educator',
    'Dialysis Nursing Patient Coach', 'Oncology Nursing Symptom Educator', 'Psychiatric Nursing De-escalation Trainer', 'Community Health Nursing Advisor',
    'Nurse Informatics Workflow Coach', 'Travel Nursing Compliance Advisor', 'Nursing Capstone Mentor', 'Allied Health Team Coordinator',
    'Respiratory Therapist Educator', 'Occupational Therapy Referral Navigator',
  ]);

  addMedical('medical-rehabilitation-therapy', 'Medical · Rehabilitation & Therapy', [
    'Physical Therapy Exercise Educator', 'Occupational Therapy ADL Coach', 'Speech Therapy Communication Coach', 'Cardiac Rehab Phase Educator',
    'Pulmonary Rehab Breathing Coach', 'Neurologic Rehab Gait Advisor', 'Sports Injury Rehab Planner', 'Stroke Rehab Home Program Coach',
    'Vestibular Rehab Dizziness Educator', 'Pelvic Rehab Specialist Advisor', 'Prosthetics & Orthotics Navigator', 'Aquatic Therapy Program Coach',
    'Pediatric Rehab Play-Based Educator', 'Spinal Cord Injury Rehab Advisor', 'Amputee Mobility Training Coach', 'Vocational Rehab Counselor',
    'Chronic Pain Rehab Coping Educator', 'Hand Therapy Fine Motor Coach', 'Swallowing Therapy Diet Texture Advisor', 'Cognitive Rehab Memory Coach',
    'Rehab Insurance Authorization Navigator', 'Tele-rehab Engagement Coach',
  ]);

  addMedical('medical-public-health-epidemiology', 'Medical · Public Health & Epidemiology', [
    'Epidemic Modeling Literacy Educator', 'Outbreak Investigation Tabletop Facilitator', 'Immunization Program Planner', 'Health Equity Policy Advisor',
    'Environmental Health Risk Communicator', 'Maternal & Child Health Program Coach', 'Global Health Logistics Advisor', 'Biostatistics for Policy Educator',
    'Contact Tracing Operations Coach', 'School Outbreak Response Advisor', 'Water Sanitation Health Educator', 'Tobacco Control Program Planner',
    'Nutrition Policy Advisor', 'Injury Prevention Epidemiologist Educator', 'Refugee Health Program Navigator', 'Pandemic Preparedness Planner',
    'Health Department Accreditation Coach', 'Syndromic Surveillance Explainer', 'Public Health One Health Zoonosis Educator', 'Climate Health Adaptation Advisor',
    'Community Needs Assessment Facilitator', 'Public Health Data Dashboard Coach',
  ]);

  addMedical('medical-sports-occupational-health', 'Medical · Sports & Occupational Health', [
    'Sports Concussion Protocol Educator', 'Return-to-Play Decision Literacy Coach', 'Athletic Trainer Injury Prevention Advisor', 'Workplace Ergonomics Coach',
    'OSHA Compliance Health Advisor', 'Industrial Hygiene Exposure Educator', 'Hearing Conservation Program Coach', 'Respirator Fit & Use Educator',
    'Shift Work Sleep Health Advisor', 'Repetitive Strain Injury Prevention Coach', 'Construction Site Safety Health Advisor', 'Office Worker Movement Coach',
    'Firefighter Fitness Health Advisor', 'Nurse Safe Patient Handling Coach', 'Driver Medical Fitness Educator', 'Heat Illness Prevention Coach',
    'Cold Stress Workplace Advisor', 'Chemical Exposure First Aid Educator', 'Return-to-Work Accommodation Planner', 'Functional Capacity Evaluation Explainer',
    'Corporate Wellness Program Designer', 'Occupational Mental Health Advisor',
  ]);

  addMedical('medical-dermatology-sensory', 'Medical · Dermatology & Sensory Health', [
    'Acne Care Education Coach', 'Eczema Flare Management Advisor', 'Psoriasis Lifestyle Educator', 'Skin Cancer Screening Literacy Guide',
    'Sun Protection Educator', 'Hair Loss Evaluation Navigator', 'Rosacea Trigger Coach', 'Wound Scar Management Educator',
    'Pediatric Rash Literacy Advisor', 'Contact Dermatitis Patch Test Explainer', 'Melanoma ABCDE Educator', 'Vitiligo Support Coach',
    'Hidradenitis Support Navigator', 'Burn Scar Rehab Educator', 'Cosmetic Dermatology Expectation Coach', 'Audiology Hearing Aid Educator',
    'Tinnitus Coping Skills Coach', 'Ophthalmology Glaucoma Educator', 'Dry Eye Lifestyle Advisor', 'Cataract Surgery Expectation Coach',
    'Low Vision Assistive Tech Advisor', 'Allergic Rhinitis Management Coach',
  ]);

  addMedical('medical-oncology-hematology', 'Medical · Oncology & Hematology', [
    'Chemotherapy Side Effect Educator', 'Radiation Therapy Prep Coach', 'Immunotherapy Literacy Advisor', 'Cancer Clinical Trial Navigator',
    'Oncology Nutrition Support Coach', 'Palliative Oncology Communication Advisor', 'Survivorship Care Plan Educator', 'Tumor Board Literacy Explainer',
    'Breast Cancer Screening Navigator', 'Colorectal Cancer Screening Educator', 'Lung Cancer Risk Reduction Coach', 'Prostate Cancer Decision Aid Educator',
    'Leukemia Family Support Navigator', 'Lymphoma Treatment Pathway Educator', 'Multiple Myeloma Support Coach', 'Sickle Cell Crisis Plan Educator',
    'Hemophilia Home Care Advisor', 'Anemia Workup Literacy Coach', 'Oncology Bone Marrow Transplant Educator', 'Cancer Pain Management Literacy Guide',
    'Oncofertility Preservation Educator', 'Cancer Financial Toxicity Navigator',
  ]);

  addMedical('medical-neurology-neuroscience-clinical', 'Medical · Neurology (Clinical Literacy)', [
    'Migraine Trigger & Diary Coach', 'Epilepsy Seizure Action Plan Educator', 'Parkinson\'s Medication Timing Coach', 'Multiple Sclerosis Symptom Navigator',
    'Alzheimer\'s Caregiver Educator', 'Neuropathy Foot Care Advisor', 'Bell\'s Palsy Recovery Coach', 'ALS Care Planning Navigator',
    'Neuromuscular Clinic Flow Educator', 'Headache Red Flag Literacy Guide', 'Vertigo BPPV Maneuver Educator', 'Sleep Neurology Explainer',
    'Autonomic Dysfunction Lifestyle Coach', 'Neuro ICU Family Advisor', 'Brain Tumor Treatment Literacy Educator', 'Spasticity Management Coach',
    'Neurorehabilitation Home Program Advisor', 'Pediatric Neurology Parent Coach', 'Stroke Secondary Prevention Educator', 'Memory Clinic Navigator',
    'Functional Neurological Symptom Educator', 'Neurogenetics Counseling Literacy Guide',
  ]);

  // ─── Science & Research ─────────────────────────────────────────────
  const addScience = (id, label, iconId, titles) => {
    defs.push({
      id,
      label,
      iconId,
      skillBank: ['Scientific Method', 'Literature Review', 'Experimental Design', 'Data Analysis', 'Peer Review', 'Lab Safety', 'Reproducibility', 'Hypothesis Testing', 'Instrumentation', 'Technical Writing', 'Grant Writing', 'Ethics Compliance'],
      traitBank: scienceTraits,
      roles: rolesFromTitles(label, titles, 'research methodology and applied science guidance'),
    });
  };

  addScience('theoretical-physical-sciences', 'Theoretical Physical Sciences', 'science', [
    'Theoretical Physicist Advisor', 'Quantum Mechanics Educator', 'Condensed Matter Theorist', 'Particle Physics Explainer',
    'Cosmology Model Educator', 'String Theory Literacy Guide', 'Mathematical Physics Tutor', 'Statistical Mechanics Coach',
    'Relativity Concepts Educator', 'Computational Physics Advisor', 'Astrophysics Theory Coach', 'Plasma Physics Educator',
    'Nuclear Physics Theory Advisor', 'Optics & Photonics Theorist', 'Fluid Dynamics Theorist', 'Chaos Theory Educator',
    'Field Theory Tutor', 'Symmetry & Group Theory Coach', 'Numerical Simulation Advisor', 'Open Science Physics Advocate',
    'Physics Education Researcher', 'Interdisciplinary Modeling Theorist',
  ]);

  addScience('applied-engineering-sciences', 'Applied Engineering Sciences', 'biotech', [
    'Materials Science Engineer', 'Nanotechnology Applications Advisor', 'Biomedical Engineering Coach', 'Robotics Research Advisor',
    'Mechatronics Systems Educator', 'Acoustics Engineering Specialist', 'Optical Engineering Advisor', 'Semiconductor Process Educator',
    'Battery Chemistry Engineer', 'Composite Materials Advisor', 'Hydraulics & Pneumatics Educator', 'Thermal Systems Engineer',
    'Control Systems Scientist', 'Human Factors Engineering Advisor', 'Systems Engineering Research Coach', 'Reliability Engineering Scientist',
    'Failure Analysis Engineer', 'Prototyping Lab Advisor', 'Metrology & Calibration Specialist', 'Industrial R&D Strategist',
    'Technology Readiness Level Coach', 'Applied Math for Engineers Tutor',
  ]);

  addScience('space-science-astronomy', 'Space Science & Astronomy', 'rocket_launch', [
    'Observational Astronomer Advisor', 'Planetary Science Educator', 'Space Mission Design Coach', 'Orbital Mechanics Tutor',
    'Satellite Systems Engineer', 'Space Weather Analyst', 'Exoplanet Research Educator', 'Radio Astronomy Specialist',
    'Astrobiology Literacy Coach', 'Rocket Propulsion Educator', 'Space Policy Advisor', 'Lunar Exploration Planner',
    'Mars Habitat Research Advisor', 'Space Debris Mitigation Analyst', 'CubeSat Mission Coach', 'Space Telescope Operations Educator',
    'Cosmological Survey Planner', 'Astronaut Training Literacy Guide', 'Ground Station Operations Advisor', 'Space Law & Ethics Educator',
    'Citizen Science Astronomy Coach', 'Heliophysics Educator',
  ]);

  addScience('biological-life-sciences', 'Biological & Life Sciences', 'biotech', [
    'Molecular Biology Advisor', 'Cell Culture Lab Coach', 'Genomics Research Educator', 'Proteomics Specialist',
    'Microbiology Research Advisor', 'Immunology Lab Educator', 'Ecology Field Study Coach', 'Marine Biology Advisor',
    'Botany Research Specialist', 'Zoology Educator', 'Evolutionary Biology Tutor', 'Developmental Biology Coach',
    'CRISPR Literacy Educator', 'Bioinformatics Pipeline Advisor', 'Synthetic Biology Designer', 'Virology Research Coach',
    'Biodiversity Conservation Scientist', 'Entomology Specialist', 'Mycology Research Advisor', 'Neuroscience Research Educator',
    'Stem Cell Research Literacy Guide', 'Biostatistics for Biologists Coach',
  ]);

  addScience('chemistry-materials-science', 'Chemistry & Materials Science', 'science', [
    'Organic Chemistry Tutor', 'Inorganic Chemistry Educator', 'Analytical Chemistry Advisor', 'Physical Chemistry Coach',
    'Biochemistry Lab Advisor', 'Polymer Chemistry Specialist', 'Electrochemistry Educator', 'Catalysis Research Coach',
    'Green Chemistry Advisor', 'Crystallography Specialist', 'Spectroscopy Methods Educator', 'Chromatography Lab Coach',
    'Chemical Safety Officer Advisor', 'Process Chemistry Scale-Up Coach', 'Pharmaceutical Chemistry Educator', 'Food Chemistry Analyst',
    'Environmental Chemistry Advisor', 'Computational Chemistry Coach', 'Surface Chemistry Specialist', 'Coordination Chemistry Tutor',
    'Laboratory Informatics Chemist', 'Quality Control Chemistry Advisor',
  ]);

  addScience('environmental-earth-sciences', 'Environmental & Earth Sciences', 'eco', [
    'Climate Science Literacy Educator', 'Geology Field Advisor', 'Oceanography Research Coach', 'Hydrology & Watershed Specialist',
    'Seismology Risk Educator', 'Volcanology Monitoring Advisor', 'Meteorology Forecast Coach', 'Soil Science Educator',
    'Atmospheric Chemistry Advisor', 'Remote Sensing Earth Scientist', 'GIS Environmental Analyst', 'Conservation Biology Coach',
    'Wildlife Ecology Advisor', 'Carbon Cycle Research Educator', 'Renewable Resource Analyst', 'Environmental Impact Assessment Coach',
    'Paleontology Educator', 'Speleology Cave Science Advisor', 'Glaciology Climate Coach', 'Coastal Erosion Specialist',
    'Environmental Justice Policy Advisor', 'Citizen Climate Action Facilitator',
  ]);

  // ─── Agriculture, Fisheries, Farming ────────────────────────────────
  const addField = (id, label, iconId, titles, skillBank) => {
    defs.push({
      id,
      label,
      iconId,
      skillBank: skillBank ?? ['Crop Management', 'Soil Health', 'Irrigation', 'Pest Management', 'Harvest Logistics', 'Farm Economics', 'Sustainability', 'Equipment Ops', 'Food Safety', 'Supply Chain', 'Regulatory Compliance', 'Extension Education'],
      traitBank: fieldTraits,
      roles: rolesFromTitles(label, titles, 'field operations and agri-food systems guidance'),
    });
  };

  addField('fisheries-aquaculture-marine', 'Fisheries & Aquaculture', 'sailing', [
    'Commercial Fisheries Manager', 'Aquaculture Farm Advisor', 'Fish Health Veterinarian Educator', 'Hatchery Operations Specialist',
    'Marine Stock Assessment Analyst', 'Trawl Gear Safety Advisor', 'Sustainable Fishing Certifier', 'Shellfish Farming Coach',
    'Algae & Seaweed Cultivation Advisor', 'Fish Processing QA Specialist', 'Cold Chain Seafood Logistics Coach', 'Recreational Fisheries Educator',
    'Inland Fisheries Biologist', 'Cage Culture Operations Advisor', 'Water Quality for Aquaculture Coach', 'Feed Formulation Specialist',
    'Fisheries Co-op Business Advisor', 'Marine Protected Area Planner', 'Bycatch Reduction Specialist', 'Aquaponics Systems Designer',
    'Ornamental Fish Trade Compliance Advisor', 'Fisheries Export Documentation Coach',
  ]);

  addField('crop-farming-agronomy', 'Crop Farming & Agronomy', 'agriculture', [
    'Corn & Soy Rotation Advisor', 'Wheat Production Specialist', 'Rice Paddy Management Coach', 'Organic Farming Certifier',
    'Precision Agriculture Technologist', 'Greenhouse Crop Manager', 'Viticulture & Winery Advisor', 'Cotton Production Specialist',
    'Horticulture Orchard Manager', 'Cover Crop Strategist', 'No-Till Farming Coach', 'Seed Selection Advisor',
    'Fertilizer Management Specialist', 'Drip Irrigation Designer', 'Farm Mechanization Advisor', 'Crop Insurance Literacy Coach',
    'CSA Farm Business Planner', 'Urban Farming Specialist', 'Silvopasture Integration Advisor', 'Pollinator Habitat Planner',
    'Post-Harvest Grain Storage Coach', 'Agronomy Extension Educator',
  ]);

  addField('livestock-animal-husbandry', 'Livestock & Animal Husbandry', 'pets', [
    'Cattle Ranch Operations Advisor', 'Dairy Herd Management Coach', 'Poultry Farm Biosecurity Specialist', 'Swine Production Advisor',
    'Sheep & Goat Husbandry Educator', 'Horse Stable Management Coach', 'Pasture Rotation Planner', 'Livestock Nutrition Formulator',
    'Artificial Insemination Program Advisor', 'Animal Welfare Audit Coach', 'Veterinary Parasite Control Educator', 'Barn Ventilation Designer',
    'Livestock Auction Market Advisor', 'Meat Processing HACCP Coach', 'Organic Livestock Certifier', 'Range Management Specialist',
    'Feedlot Operations Advisor', 'Livestock Transport Welfare Coach', 'Breeding Genetics Advisor', 'Farm Biosecurity Planner',
    'Manure Management Environmental Advisor', 'Youth Livestock Show Educator',
  ]);

  addField('agricultural-science-research', 'Agricultural Science & Research', 'science', [
    'Plant Breeding Research Advisor', 'Soil Microbiology Scientist', 'Entomology IPM Researcher', 'Plant Pathology Lab Coach',
    'Agricultural Economics Researcher', 'Climate-Smart Agriculture Scientist', 'Ag Robotics Research Advisor', 'Vertical Farming R&D Specialist',
    'Biopesticide Development Advisor', 'Crop Modeling Simulation Coach', 'Food Security Policy Researcher', 'Ag Extension Trial Designer',
    'Postharvest Physiology Scientist', 'Ag Data Analytics Researcher', 'Sustainable Intensification Advisor', 'Ag Policy Impact Analyst',
    'Livestock Genetics Research Coach', 'Aquaculture R&D Specialist', 'Ag Education Curriculum Designer', 'Rural Innovation Hub Advisor',
    'Seed Technology Researcher', 'Agrochemical Efficacy Trial Coach',
  ]);

  // ─── Archaeology, Heritage, Food Safety ───────────────────────────
  addField('archaeology-cultural-heritage', 'Archaeology & Cultural Heritage', 'museum', [
    'Field Archaeologist Advisor', 'Underwater Archaeology Specialist', 'Bioarchaeology Analyst', 'Zooarchaeology Specialist',
    'Archaeobotany Research Coach', 'Geoarchaeology Field Advisor', 'Heritage Site Manager', 'Museum Curation Specialist',
    'Artifact Conservation Educator', 'Cultural Resource Management Advisor', 'Indigenous Heritage Liaison', 'Archaeological GIS Specialist',
    'LiDAR Survey Archaeologist', 'Epigraphy & Ancient Texts Scholar', 'Classical Archaeology Educator', 'Forensic Archaeology Advisor',
    'Public Archaeology Outreach Coach', 'Heritage Tourism Planner', 'UNESCO World Heritage Advisor', 'Repatriation Ethics Facilitator',
    'Archaeological Lab Methods Coach', 'Historic Preservation Compliance Advisor',
  ], ['Excavation Methods', 'Stratigraphy', 'Artifact Analysis', 'Conservation', 'Heritage Law', 'GIS Mapping', 'Public Outreach', 'Museum Studies', 'Ethics', 'Documentation', 'Survey Technology', 'Cultural Sensitivity']);

  addField('food-safety-quality-systems', 'Food Safety & Quality Systems', 'restaurant', [
    'HACCP Program Designer', 'SQF Certification Coach', 'FDA FSMA Compliance Advisor', 'Food Microbiology Lab Coach',
    'Allergen Control Program Specialist', 'Sanitation SSOP Auditor', 'Cold Chain Food Safety Manager', 'Restaurant Health Inspection Prep Coach',
    'Food Recall Crisis Advisor', 'Supplier Food Safety Auditor', 'BRCGS Standard Implementer', 'Food Defense & Tampering Advisor',
    'Nutrition Labeling Compliance Coach', 'Organic Food Certifier', 'Halal & Kosher Audit Advisor', 'Food Fraud Prevention Specialist',
    'Produce Safety Rule Educator', 'Meat & Poultry Inspection Literacy Guide', 'Food Plant Pest Control Advisor', 'Water Quality in Food Plants Coach',
    'Food Safety Training Developer', 'Export Food Regulation Navigator',
  ]);

  // ─── Government, Law, Public Sector ───────────────────────────────
  const addGov = (id, label, titles, iconId = 'landmark') => {
    defs.push({
      id,
      label,
      iconId,
      businessCategory: true,
      skillBank: ['Public Policy', 'Regulatory Compliance', 'Administrative Law', 'Program Management', 'Stakeholder Engagement', 'Public Records', 'Budgeting', 'Ethics', 'Civic Process', 'Grant Administration', 'Emergency Management', 'Community Outreach'],
      traitBank: govTraits,
      roles: rolesFromTitles(label, titles, 'public sector process and policy navigation'),
    });
  };

  addGov('government-executive-legislative', 'Government · Executive & Legislative', [
    'City Manager Operations Advisor', 'County Administrator Coach', 'Legislative Bill Analysis Specialist', 'Committee Hearing Prep Coach',
    'Constituent Services Manager', 'Mayor\'s Office Policy Advisor', 'Parliamentary Procedure Educator', 'City Municipal Budget Analyst',
    'Public-Private Partnership Advisor', 'Ethics & Conflicts Counselor', 'Lobbying Disclosure Compliance Coach', 'Election Administration Advisor',
    'Redistricting Policy Educator', 'Legislative Intergovernmental Relations Specialist', 'State Agency Program Auditor', 'Federal Grants Compliance Coach',
    'Legislative Staff Researcher', 'Executive Order Implementation Planner', 'Civic Engagement Facilitator', 'Transparency & FOIA Coach',
    'Municipal Charter Revision Advisor', 'Public Meeting Facilitation Specialist',
  ]);

  addGov('government-regulatory-agencies', 'Government · Regulatory Agencies', [
    'EPA Environmental Compliance Advisor', 'FDA Regulatory Submission Coach', 'OSHA Inspection Prep Specialist', 'FCC Licensing Navigator',
    'SEC Disclosure Compliance Educator', 'FTC Consumer Protection Advisor', 'USDA Agricultural Program Coach', 'FAA Aviation Compliance Specialist',
    'DOT Transportation Safety Advisor', 'HUD Housing Program Navigator', 'IRS Taxpayer Rights Educator', 'Customs Import Compliance Coach',
    'DEA Controlled Substance Registration Advisor', 'ATF Firearms Compliance Educator', 'NRC Nuclear Regulatory Literacy Guide', 'CMS Medicare Policy Navigator',
    'State Health Department Licensing Coach', 'Professional Licensing Board Advisor', 'Weights & Measures Inspector Educator', 'Building Code Enforcement Coach',
    'Pesticide Registration Regulatory Advisor', 'Occupational Licensing Reform Analyst',
  ], 'policy');

  addGov('immigration-border-civil-services', 'Immigration, Border & Civil Services', [
    'Immigration Visa Category Educator', 'Asylum Process Literacy Navigator', 'Citizenship Test Prep Coach', 'Border Trade Compliance Advisor',
    'Customs Broker Documentation Coach', 'Refugee Resettlement Case Advisor', 'Work Permit Compliance Specialist', 'Student Visa Advising Coach',
    'Family Reunification Petition Educator', 'Immigration Court Process Navigator', 'Consular Services Appointment Coach', 'DACA Renewal Literacy Advisor',
    'Employer I-9 Compliance Coach', 'Humanitarian Parole Educator', 'Travel Ban & Waiver Navigator', 'Immigration Fraud Prevention Educator',
    'Naturalization Interview Prep Coach', 'Immigrant Health Access Navigator', 'Language Access Program Advisor', 'Civic Integration Program Designer',
    'Cross-Border Supply Chain Customs Coach', 'Immigration Policy Impact Analyst',
  ], 'translate');

  addGov('urban-planning-municipal-services', 'Urban Planning & Municipal Services', [
    'Comprehensive Plan Advisor', 'Zoning Code Literacy Educator', 'Transportation Master Plan Coach', 'Affordable Housing Policy Advisor',
    'Parks & Recreation Planner', 'Stormwater Infrastructure Advisor', 'Solid Waste Management Coach', 'Water Utility Rate Analyst',
    'Public Transit Equity Planner', 'Historic District Planner', 'Smart City IoT Advisor', 'Building Permit Expediter Coach',
    'Code Enforcement Navigator', 'Neighborhood Revitalization Facilitator', 'GIS Urban Analytics Specialist', 'Climate Resilience Urban Planner',
    'Public Works Capital Planning Advisor', 'Sidewalk & ADA Compliance Coach', 'Street Lighting Energy Planner', 'Municipal Broadband Advisor',
    'Land Use Hearing Facilitator', 'Downtown Economic Development Coach',
  ], 'apartment');

  addGov('law-enforcement-public-safety', 'Law Enforcement & Public Safety', [
    'Community Policing Program Advisor', 'Crime Prevention Through Environmental Design Coach', '911 Dispatch Protocol Educator', 'Fire Prevention Inspector Coach',
    'Emergency Management Coordinator', 'School Resource Officer Policy Advisor', 'Body-Worn Camera Policy Educator', 'Evidence Chain of Custody Trainer',
    'Domestic Violence Response Protocol Coach', 'Cybercrime Reporting Navigator', 'Search & Rescue Operations Planner', 'Hazmat Response Tabletop Facilitator',
    'Corrections Reentry Program Advisor', 'Probation & Parole Compliance Coach', 'Juvenile Justice Diversion Educator', 'Traffic Safety Engineering Advisor',
    'Public Assembly Safety Planner', 'Critical Incident Stress Management Educator', 'Mutual Aid Agreement Facilitator', 'False Alarm Reduction Program Coach',
    'License Plate Reader Policy Advisor', 'Neighborhood Watch Facilitator',
  ], 'police');

  // ─── Legal (expanded) ───────────────────────────────────────────────
  defs.push({
    id: 'legal-practice-specialties',
    label: 'Legal Practice Specialties',
    iconId: 'gavel',
    businessCategory: true,
    skillBank: ['Legal Research', 'Case Strategy', 'Contract Drafting', 'Compliance', 'Litigation Support', 'Discovery', 'Legal Writing', 'Client Counseling', 'Regulatory Analysis', 'Alternative Dispute Resolution', 'Legal Ethics', 'Court Procedure'],
    traitBank: govTraits,
    roles: rolesFromTitles('Legal Practice', [
      'Corporate Transaction Attorney Advisor', 'Mergers & Acquisitions Counsel', 'Securities Law Specialist', 'Intellectual Property Strategist',
      'Patent Prosecution Advisor', 'Trademark Portfolio Counsel', 'Employment Law Practice Advisor', 'Labor Relations Counsel',
      'Real Estate Transaction Attorney', 'Landlord-Tenant Law Educator', 'Family Law Mediation Advisor', 'Estate Planning Counsel',
      'Immigration Attorney Advisor', 'Criminal Defense Strategy Coach', 'Prosecution Case Theory Educator', 'Personal Injury Case Analyst',
      'Medical Malpractice Literacy Advisor', 'Environmental Law Counsel', 'Tax Controversy Advisor', 'Bankruptcy Restructuring Counsel',
      'Antitrust Compliance Advisor', 'International Arbitration Specialist',
    ], 'legal information and process literacy — not licensed legal advice'),
  });

  // ─── Forensic & Investigation ───────────────────────────────────────
  addScience('forensic-science-investigation', 'Forensic Science & Investigation', 'forensic', [
    'Crime Scene Processing Advisor', 'Forensic DNA Analysis Educator', 'Digital Forensics Investigator Coach', 'Forensic Accounting Specialist',
    'Ballistics & Firearms Examiner Educator', 'Forensic Toxicology Literacy Coach', 'Fingerprint Analysis Trainer', 'Forensic Anthropology Advisor',
    'Bloodstain Pattern Educator', 'Cyber Forensics Incident Coach', 'Forensic Interview Specialist', 'Chain of Evidence Auditor',
    'Forensic Lab Quality Coach', 'Arson Investigation Educator', 'Document Examination Specialist', 'Mobile Device Forensics Coach',
    'Forensic Pathology Literacy Guide', 'Fraud Investigation Advisor', 'Insurance Claims Forensics Coach', 'OSINT Investigation Educator',
    'Expert Witness Prep Coach', 'Cold Case Review Facilitator',
  ]);

  // ─── Education & Research Administration ──────────────────────────
  addGov('higher-education-research-admin', 'Higher Education & Research Admin', [
    'University Registrar Operations Coach', 'Research Grants Administration Advisor', 'IRB Ethics Submission Coach', 'Tenure Track Career Advisor',
    'Academic Accreditation Prep Specialist', 'Student Financial Aid Navigator', 'International Student Services Advisor', 'Faculty Hiring Committee Coach',
    'Lab Safety Compliance Educator', 'Technology Transfer Office Advisor', 'Dissertation Committee Process Coach', 'Academic Integrity Program Designer',
    'DEI Campus Program Facilitator', 'Alumni Relations Strategist', 'Continuing Education Program Designer', 'Library Science Digital Resources Advisor',
    'Campus IT Academic Support Coach', 'Study Abroad Program Advisor', 'Faculty Workload Policy Analyst', 'Research Data Management Plan Coach',
    'Open Access Publishing Advisor', 'Academic Conference Planning Specialist',
  ], 'school');

  // ─── Additional cross-cutting domains ─────────────────────────────
  addField('veterinary-animal-health', 'Veterinary & Animal Health (Non-Human)', 'pets', [
    'Small Animal Practice Advisor', 'Large Animal Veterinarian Educator', 'Wildlife Veterinarian Specialist', 'Equine Health Coach',
    'Avian Veterinary Advisor', 'Exotic Pet Health Educator', 'Veterinary Surgery Recovery Coach', 'Animal Shelter Medicine Advisor',
    'Zoo Veterinary Operations Coach', 'Veterinary Pharmacology Educator', 'Livestock Veterinary Public Health Advisor', 'Aquatic Animal Health Specialist',
    'Veterinary Dentistry Educator', 'Animal Behavior Modification Coach', 'Veterinary Telemedicine Advisor', 'Veterinary One Health Zoonosis Educator',
    'Pet Nutrition Formulation Coach', 'Veterinary Practice Management Advisor', 'Animal Rehabilitation Therapist Educator', 'Veterinary Lab Diagnostics Coach',
    'Spay Neuter Program Planner', 'Veterinary Ethics & Welfare Advisor',
  ]);

  addField('religious-chaplaincy-spiritual-care', 'Chaplaincy & Spiritual Care', 'volunteer_activism', [
    'Hospital Chaplain Advisor', 'Military Chaplain Educator', 'Prison Chaplaincy Coach', 'Campus Chaplain Specialist',
    'Grief & Bereavement Spiritual Counselor', 'Crisis Chaplain Deployment Coach', 'Interfaith Dialogue Facilitator', 'End-of-Life Spiritual Care Advisor',
    'Disaster Spiritual Care Responder', 'Corporate Chaplaincy Program Designer', 'Pastoral Care Documentation Coach', 'Ritual & Liturgy Planning Advisor',
    'Spiritual Assessment Educator', 'Chaplaincy Ethics Advisor', 'Children\'s Hospital Chaplain Coach', 'Palliative Spiritual Care Navigator',
    'Addiction Recovery Spiritual Support Advisor', 'Veterans Spiritual Reintegration Coach', 'Hospice Chaplain Educator', 'Community Faith Outreach Planner',
    'Spiritual Care Research Advisor', 'Chaplain Supervision & Training Coach',
  ]);

  addField('library-information-science', 'Library & Information Science', 'menu_book', [
    'Public Library Program Designer', 'Academic Librarian Research Coach', 'Digital Archives Specialist', 'Metadata & Cataloging Advisor',
    'Special Collections Curator Educator', 'Information Literacy Instructor', 'School Library Media Specialist', 'Law Library Research Coach',
    'Medical Librarian Literature Search Advisor', 'Corporate Knowledge Manager', 'Open Educational Resources Curator', 'Library Technology Integration Coach',
    'Preservation & Digitization Specialist', 'Children\'s Literacy Program Designer', 'Community Archives Facilitator', 'Reference Desk Strategy Coach',
    'Library Advocacy & Funding Advisor', 'Intellectual Freedom Policy Educator', 'Interlibrary Loan Operations Coach', 'Data Curation Specialist',
    'Taxonomy & Ontology Designer', 'Citizen Science Library Liaison',
  ]);

  return defs;
}
