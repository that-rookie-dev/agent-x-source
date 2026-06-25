/**
 * ABMS-aligned medical specialty categories and allied health roles.
 * Merged into generate-crew-hub.mjs — each category has >= 20 unique role titles.
 */

function rolesFromTitles(categoryLabel, titles, specialtyPrefix) {
  return titles.map((title) => ({
    title,
    specialty: `${specialtyPrefix} for ${title.toLowerCase()} — planning, education, and care navigation`,
  }));
}

const medicalTraits = ['ethical', 'empathetic', 'evidence-minded', 'patient-focused', 'clear', 'cautious'];
const medicalSkillBank = [
  'Clinical Literacy', 'Care Pathways', 'Patient Education', 'Medical Terminology', 'Evidence Review',
  'Care Coordination', 'Health Literacy', 'Risk Communication', 'Preventive Health', 'Chronic Disease Support',
  'Referral Navigation', 'Documentation',
];

/** @returns {import('./generate-crew-hub.mjs').CategoryDef[]} */
export function medicalSpecialtyCategoryDefinitions() {
  const defs = [];

  const addMedical = (id, label, titles) => {
    defs.push({
      id,
      label,
      iconId: 'local_hospital',
      medicalCategory: true,
      skillBank: medicalSkillBank,
      traitBank: medicalTraits,
      roles: rolesFromTitles(label, titles, 'informational health education and care navigation'),
    });
  };

  addMedical('medical-allergy-immunology', 'Medical · Allergy & Immunology', [
    'Allergy & Immunology Educator', 'Seasonal Allergy Management Coach', 'Food Allergy Action Plan Advisor',
    'Drug Allergy Documentation Educator', 'Asthma-Allergy Overlap Navigator', 'Eosinophilic Disorder Literacy Guide',
    'Urticaria & Angioedema Educator', 'Immunodeficiency Screening Navigator', 'Allergy Immunotherapy Journey Coach',
    'Anaphylaxis Emergency Plan Educator', 'Pediatric Allergy Family Advisor', 'Occupational Allergy Exposure Coach',
    'Contact Allergen Avoidance Educator', 'Allergic Rhinitis Treatment Options Guide', 'Atopic Dermatitis Allergy Link Educator',
    'Venom Allergy Desensitization Educator', 'Latex Allergy Workplace Advisor', 'Autoimmune vs Allergy Literacy Coach',
    'Allergy Testing Interpretation Educator', 'Biologic Therapy for Allergy Educator', 'Allergy Clinic Referral Navigator',
    'Immune Tolerance Research Literacy Advisor',
  ]);

  addMedical('medical-anesthesiology', 'Medical · Anesthesiology', [
    'Anesthesiology Pre-Op Educator', 'General Anesthesia Expectation Coach', 'Regional Anesthesia Options Advisor',
    'Spinal Epidural Labor Educator', 'Sedation for Procedures Coach', 'Anesthesia Risk Assessment Literacy Guide',
    'NPO Pre-Surgery Fasting Educator', 'Post-Anesthesia Recovery Coach', 'PONV Nausea Prevention Educator',
    'Anesthesia for Pediatric Surgery Advisor', 'Geriatric Anesthesia Risk Educator', 'Obstructive Sleep Apnea Anesthesia Coach',
    'Malignant Hyperthermia Family Educator', 'Chronic Pain & Anesthesia Planning Advisor', 'Cardiac Anesthesia Literacy Guide',
    'Neuroanesthesia Patient Educator', 'Ambulatory Surgery Anesthesia Coach', 'Anesthesia Awareness Concerns Educator',
    'Opioid-Sparing Anesthesia Options Advisor', 'Anesthesia Consent Process Educator', 'ICU Sedation Family Advisor',
    'Anesthesia Quality & Safety Literacy Coach',
  ]);

  addMedical('medical-cardiology-vascular', 'Medical · Cardiology & Vascular Medicine', [
    'Cardiology Heart Failure Educator', 'Coronary Artery Disease Lifestyle Coach', 'Arrhythmia Monitoring Advisor',
    'Atrial Fibrillation Anticoagulation Educator', 'Hypertension Cardiology Coach', 'Valvular Heart Disease Navigator',
    'Cardiac Rehabilitation Phase Educator', 'Interventional Cardiology Prep Advisor', 'Electrophysiology Ablation Educator',
    'Lipid Management Cardiology Coach', 'Peripheral Artery Disease Walker Educator', 'Cardiac Device Pacemaker Advisor',
    'ICD Defibrillator Lifestyle Educator', 'Congenital Heart Disease Adult Transition Coach', 'Cardiomyopathy Family Navigator',
    'Cardiac Imaging Stress Test Educator', 'Women\'s Heart Health Advisor', 'Sports Cardiology Clearance Educator',
    'Cardiac Transplant Candidacy Navigator', 'Pulmonary Hypertension Cardiology Coach', 'Syncope Evaluation Literacy Guide',
    'Cardiovascular Prevention Program Designer',
  ]);

  addMedical('medical-gastroenterology-hepatology', 'Medical · Gastroenterology & Hepatology', [
    'Gastroenterology IBD Educator', 'Crohn\'s Disease Flare Coach', 'Ulcerative Colitis Management Advisor',
    'GERD Lifestyle Modification Educator', 'Celiac Disease Gluten-Free Coach', 'Irritable Bowel Syndrome Navigator',
    'Colonoscopy Prep Educator', 'Endoscopy Procedure Expectation Coach', 'Hepatitis B & C Literacy Advisor',
    'Cirrhosis Complication Prevention Educator', 'Fatty Liver Disease Lifestyle Coach', 'Pancreatitis Recovery Advisor',
    'GI Bleeding Red Flag Educator', 'Barrett\'s Esophagus Surveillance Coach', 'Diverticulitis Diet Educator',
    'Gallbladder Disease Surgical Options Advisor', 'Motility Disorder Educator', 'Liver Transplant Evaluation Navigator',
    'Pediatric GI Nutrition Coach', 'GI Cancer Screening Educator', 'Microbiome Health Literacy Advisor',
    'Enteral & Parenteral Nutrition GI Coach',
  ]);

  addMedical('medical-pulmonology-critical-care', 'Medical · Pulmonology & Critical Care', [
    'Pulmonology COPD Action Plan Coach', 'Asthma Controller Medication Educator', 'Pulmonary Fibrosis Support Navigator',
    'Sleep-Disordered Breathing Pulmonology Advisor', 'Lung Cancer Screening Educator', 'Pulmonary Rehab Enrollment Coach',
    'Mechanical Ventilation Family Educator', 'ARDS ICU Literacy Advisor', 'Pleural Effusion Procedure Educator',
    'Bronchiectasis Airway Clearance Coach', 'Pulmonary Hypertension Medication Educator', 'Occupational Lung Disease Advisor',
    'Cystic Fibrosis Adult Transition Coach', 'Home Oxygen Therapy Educator', 'Pulmonary Function Test Explainer',
    'Critical Care Sedation Weaning Educator', 'Sepsis ICU Recovery Advisor', 'Tracheostomy Care Home Coach',
    'Lung Transplant Candidacy Navigator', 'Interstitial Lung Disease Support Educator', 'Pulmonary Embolism Prevention Coach',
    'Long COVID Pulmonary Recovery Advisor',
  ]);

  addMedical('medical-nephrology', 'Medical · Nephrology', [
    'Nephrology CKD Stage Educator', 'Dialysis Modality Selection Coach', 'Hemodialysis Access Care Advisor',
    'Peritoneal Dialysis Home Training Educator', 'Kidney Transplant Evaluation Navigator', 'Electrolyte Disorder Literacy Coach',
    'Glomerulonephritis Patient Educator', 'Kidney Stone Prevention Advisor', 'Hypertension Renal Link Educator',
    'Anemia of CKD Management Coach', 'Mineral Bone Disorder Educator', 'Nephrotic Syndrome Diet Advisor',
    'Acute Kidney Injury Recovery Educator', 'Contrast Nephropathy Prevention Coach', 'Pediatric Nephrology Family Advisor',
    'Polycystic Kidney Disease Navigator', 'Lupus Nephritis Monitoring Educator', 'Diabetic Nephropathy Prevention Coach',
    'Renal Diet Sodium Potassium Educator', 'Home Dialysis Supply Logistics Coach', 'Nephrology Telehealth Follow-Up Advisor',
    'Kidney Palliative Care Planning Educator',
  ]);

  addMedical('medical-endocrinology-metabolism', 'Medical · Endocrinology & Metabolism', [
    'Endocrinology Diabetes Technology Coach', 'Type 1 Diabetes Carb Counting Educator', 'Type 2 Diabetes Remission Lifestyle Advisor',
    'Thyroid Nodule Evaluation Navigator', 'Hypothyroidism Medication Timing Coach', 'Hyperthyroidism Treatment Options Educator',
    'Adrenal Insufficiency Sick Day Educator', 'Cushing Syndrome Recovery Advisor', 'PCOS Endocrine Management Coach',
    'Osteoporosis Bone Health Educator', 'Calcium & Vitamin D Optimization Advisor', 'Pituitary Tumor Literacy Navigator',
    'Growth Hormone Deficiency Educator', 'Male Hypogonadism Counseling Coach', 'Menopause Hormone Therapy Educator',
    'Metabolic Syndrome Intervention Advisor', 'Lipid Endocrine Disorder Educator', 'Diabetes in Pregnancy Coach',
    'Continuous Glucose Monitor Training Educator', 'Insulin Pump Onboarding Coach', 'Rare Endocrine Disorder Family Navigator',
    'Endocrine Telemedicine Monitoring Advisor',
  ]);

  addMedical('medical-rheumatology-autoimmune', 'Medical · Rheumatology & Autoimmune Disease', [
    'Rheumatology Rheumatoid Arthritis Coach', 'Lupus Flare Recognition Educator', 'Psoriatic Arthritis Joint Protection Advisor',
    'Ankylosing Spondylitis Mobility Coach', 'Gout Diet & Urate Educator', 'Osteoarthritis Pain Management Advisor',
    'Fibromyalgia Pacing Skills Educator', 'Vasculitis Treatment Literacy Navigator', 'Sjogren Syndrome Dryness Coach',
    'Scleroderma Raynaud Educator', 'Myositis Weakness Management Advisor', 'Biologic Therapy Injection Coach',
    'DMARD Monitoring Lab Educator', 'Rheumatology Infusion Center Navigator', 'Juvenile Arthritis Parent Educator',
    'Autoimmune Fatigue Coping Coach', 'Rheumatology Telehealth Monitoring Advisor', 'Joint Injection Expectation Educator',
    'Rheumatoid Lung Involvement Navigator', 'Osteoporosis Fracture Prevention Coach', 'Polymyalgia Rheumatica Educator',
    'Rheumatic Disease Pregnancy Planning Advisor',
  ]);

  addMedical('medical-infectious-disease-medicine', 'Medical · Infectious Disease', [
    'Infectious Disease Antibiotic Stewardship Educator', 'HIV PrEP & Treatment Literacy Coach', 'Tuberculosis Latent Infection Advisor',
    'Sepsis Recovery & Prevention Educator', 'MRSA Decolonization Home Coach', 'C difficile Recurrence Prevention Advisor',
    'Travel Vaccine & Prophylaxis Educator', 'Tropical Disease Return Travel Navigator', 'Fungal Infection Immunocompromised Coach',
    'Endocarditis Prophylaxis Educator', 'Bone & Joint Infection Recovery Advisor', 'Healthcare Associated Infection Prevention Coach',
    'Sexually Transmitted Infection Screening Educator', 'Hepatitis Co-Infection Management Advisor', 'Opportunistic Infection Transplant Educator',
    'COVID Long-Term Immunity Literacy Coach', 'Mpox & Emerging Virus Educator', 'Antimicrobial Resistance Awareness Advisor',
    'Infection Control Home Care Educator', 'Pediatric Infectious Disease Family Navigator', 'Occupational Exposure PEP Educator',
    'Infectious Disease Teleconsult Navigator',
  ]);

  addMedical('medical-hematology', 'Medical · Hematology', [
    'Hematology Anemia Workup Educator', 'Iron Deficiency Oral vs IV Coach', 'Sickle Cell Crisis Plan Advisor',
    'Thalassemia Transfusion Navigator', 'Hemophilia Home Factor Educator', 'Deep Vein Thrombosis Anticoagulation Coach',
    'Pulmonary Embolism Recovery Educator', 'Myeloma Treatment Pathway Advisor', 'Leukemia Induction Literacy Coach',
    'Lymphoma Staging Education Navigator', 'Bone Marrow Transplant Hematology Educator', 'Bleeding Disorder Workup Advisor',
    'ITP Platelet Management Coach', 'Polycythemia Vera Monitoring Educator', 'Aplastic Anemia Support Navigator',
    'Hemochromatosis Therapeutic Phlebotomy Coach', 'von Willebrand Disease Educator', 'Antiphospholipid Syndrome Advisor',
    'Hematology Lab Result Literacy Coach', 'Pediatric Hematology Family Educator', 'Hematology Clinical Trial Navigator',
    'Blood Product Transfusion Consent Educator',
  ]);

  addMedical('medical-medical-genetics', 'Medical · Medical Genetics & Genomics', [
    'Medical Genetics Hereditary Cancer Educator', 'BRCA Risk & Screening Navigator', 'Lynch Syndrome Family Coach',
    'Rare Disease Diagnosis Journey Advisor', 'Chromosomal Microarray Result Educator', 'Whole Exome Sequencing Literacy Coach',
    'Pharmacogenomics Medication Match Educator', 'Newborn Screening Follow-Up Navigator', 'Carrier Screening Preconception Advisor',
    'Mitochondrial Disease Family Educator', 'Connective Tissue Disorder Genetics Coach', 'Neurogenetic Syndrome Navigator',
    'Inborn Errors of Metabolism Educator', 'Genetic Cardiomyopathy Screening Advisor', 'Familial Hypercholesterolemia Coach',
    'Genetic Counseling Referral Navigator', 'Direct-to-Consumer Genetic Test Educator', 'Genomic Research Consent Advisor',
    'Pediatric Genetics Development Coach', 'Adult-Onset Genetic Condition Educator', 'Genetic Registry Enrollment Navigator',
    'Genomic Equity & Access Advisor',
  ]);

  addMedical('medical-nuclear-medicine', 'Medical · Nuclear Medicine', [
    'Nuclear Medicine PET Scan Educator', 'Radioactive Tracer Safety Advisor', 'Thyroid Uptake Scan Explainer',
    'Bone Scan Metastasis Literacy Coach', 'Cardiac Nuclear Stress Test Educator', 'Renal MAG3 Scan Prep Advisor',
    'Hepatobiliary HIDA Scan Educator', 'Lung Ventilation Perfusion Scan Coach', 'Neuro PET Dementia Imaging Educator',
    'Theranostic Lutetium Therapy Advisor', 'I-131 Thyroid Therapy Prep Educator', 'Pediatric Nuclear Medicine Sedation Coach',
    'Pregnancy & Breastfeeding Imaging Safety Advisor', 'Radiopharmacy Dose Preparation Literacy Educator', 'Nuclear Medicine Radiation Dose Coach',
    'Oncology PET Response Criteria Educator', 'Sentinel Node Mapping Explainer', 'Gallium Infection Imaging Advisor',
    'Nuclear Cardiology Viability Educator', 'Therapy Isolation Precautions Coach', 'Nuclear Medicine Research Trial Navigator',
    'Molecular Imaging Clinical Trial Educator',
  ]);

  addMedical('medical-preventive-medicine', 'Medical · Preventive Medicine', [
    'Preventive Medicine Screening Schedule Educator', 'Adult Wellness Exam Coach', 'Cancer Screening Guideline Advisor',
    'Cardiovascular Risk Calculator Educator', 'Diabetes Prevention Lifestyle Coach', 'Immunization Catch-Up Navigator',
    'Travel Medicine Preventive Advisor', 'Occupational Health Screening Educator', 'Public Health Surveillance Literacy Coach',
    'Epidemic Preparedness Community Educator', 'Health Promotion Program Designer', 'Tobacco Cessation Preventive Coach',
    'Alcohol Use Screening Brief Intervention Educator', 'Obesity Prevention Population Advisor', 'Aging in Place Safety Educator',
    'Fall Prevention Community Coach', 'Sexual Health Preventive Screening Advisor', 'Skin Cancer Prevention Educator',
    'Hearing & Vision Screening Navigator', 'Preventive Genomics Population Advisor', 'Health Equity Preventive Access Coach',
    'Preventive Medicine Research Literacy Educator',
  ]);

  addMedical('medical-physical-medicine-rehab', 'Medical · Physical Medicine & Rehabilitation', [
    'PM&R Spasticity Management Educator', 'Stroke Rehab Physician Advisor', 'Spinal Cord Injury Rehab Navigator',
    'Traumatic Brain Injury Recovery Coach', 'Amputee Prosthetic Prescription Educator', 'Musculoskeletal PM&R Injection Advisor',
    'Electrodiagnosis EMG Literacy Coach', 'Chronic Pain PM&R Multimodal Educator', 'Sports Injury PM&R Return Coach',
    'Pediatric Rehab Medicine Advisor', 'Geriatric Rehab Function Coach', 'Burn Rehab Scar Management Educator',
    'Cancer Rehab Fatigue Advisor', 'Cardiac Rehab PM&R Physician Educator', 'Pulmonary Rehab PM&R Advisor',
    'Wheelchair Seating Prescription Coach', 'Adaptive Equipment Home Assessment Educator', 'Work Hardening Program Advisor',
    'Disability Evaluation Literacy Educator', 'PM&R Hospital Consult Communication Coach', 'Neuromuscular Disease Rehab Navigator',
    'PM&R Telehealth Function Assessment Advisor',
  ]);

  addMedical('medical-pain-medicine', 'Medical · Pain Medicine', [
    'Pain Medicine Multimodal Plan Educator', 'Chronic Low Back Pain Coach', 'Neuropathic Pain Medication Advisor',
    'Opioid Risk & Monitoring Educator', 'Non-Opioid Analgesic Options Coach', 'Interventional Pain Procedure Prep Advisor',
    'Epidural Steroid Injection Educator', 'Facet Joint Injection Expectation Coach', 'Spinal Cord Stimulator Trial Navigator',
    'Cancer Pain Palliative Coach', 'Fibromyalgia Pain Science Educator', 'Headache Pain Medicine Advisor',
    'CRPS Complex Regional Pain Educator', 'Pelvic Pain Multidisciplinary Coach', 'Pediatric Chronic Pain Family Advisor',
    'Pain Psychology Referral Navigator', 'Addiction & Pain Dual Diagnosis Educator', 'Workers Comp Pain Recovery Coach',
    'Pain Diary & Outcome Tracking Educator', 'Tapering Opioids Safely Coach', 'Acute Post-Surgical Pain Plan Advisor',
    'Pain Medicine Telehealth Monitoring Educator',
  ]);

  addMedical('medical-sleep-medicine', 'Medical · Sleep Medicine', [
    'Sleep Medicine Apnea Educator', 'CPAP Mask Fitting & Adherence Coach', 'Insomnia CBT-I Skills Educator',
    'Sleep Study Home vs Lab Advisor', 'Narcolepsy Symptom Navigator', 'Restless Legs Syndrome Coach',
    'Circadian Rhythm Shift Work Educator', 'Pediatric Sleep Apnea Family Advisor', 'Parasomnia Safety Educator',
    'Sleep Hygiene Program Designer', 'Hypersomnia Evaluation Literacy Coach', 'Sleep & Cardiovascular Risk Educator',
    'Menopause Sleep Disruption Coach', 'GERD & Nocturnal Reflux Sleep Advisor', 'Chronic Fatigue vs Sleep Disorder Educator',
    'Dental Sleep Medicine Appliance Coach', 'Sleep Medicine Medication Side Effect Advisor', 'Jet Lag Management Educator',
    'Sleep Telemedicine Monitoring Coach', 'Sleep & Mental Health Link Educator', 'Occupational Sleep Health Advisor',
    'Sleep Research Trial Participation Navigator',
  ]);

  addMedical('medical-hospice-palliative', 'Medical · Hospice & Palliative Medicine', [
    'Hospice Eligibility & Services Educator', 'Advance Care Planning Facilitator', 'POLST & Living Will Literacy Coach',
    'Palliative Symptom Management Educator', 'Goals of Care Conversation Coach', 'Hospice Home Comfort Care Advisor',
    'Pediatric Hospice Palliative Navigator', 'Grief & Bereavement Hospice Educator', 'Palliative Chemo Decision Support Advisor',
    'Spiritual Care Palliative Liaison Educator', 'Hospice Medication Comfort Kit Coach', 'Caregiver Burnout Palliative Advisor',
    'Palliative Pain & Dyspnea Educator', 'Hospice Respite Care Navigator', 'Veterans Palliative Benefits Educator',
    'Palliative Oncology Transition Coach', 'Dementia Late-Stage Care Educator', 'Hospice Volunteer Program Advisor',
    'Palliative Telehealth Check-In Coach', 'Ethics Consult Palliative Navigator', 'Hospice Bereavement Follow-Up Educator',
    'Palliative Quality Metrics Literacy Advisor',
  ]);

  addMedical('medical-addiction-medicine', 'Medical · Addiction Medicine', [
    'Addiction Medicine MAT Options Educator', 'Opioid Use Disorder Buprenorphine Coach', 'Alcohol Withdrawal Safety Advisor',
    'Stimulant Use Harm Reduction Educator', 'Cannabis Use Disorder Counseling Coach', 'Nicotine Dependence Pharmacotherapy Advisor',
    'Benzodiazepine Taper Educator', 'Dual Diagnosis Mental Health Navigator', 'Relapse Prevention Planning Coach',
    'Family Support Addiction Educator', 'Pregnancy & Substance Use Advisor', 'Adolescent Substance Use Screening Coach',
    'Workplace Return After Treatment Educator', 'Recovery Housing Navigation Advisor', 'Peer Recovery Coach Liaison Educator',
    'Overdose Naloxone Training Facilitator', 'Fentanyl Test Strip Safety Educator', 'Addiction Stigma Reduction Advisor',
    'Pain & Addiction Balanced Care Coach', 'Addiction Telehealth MAT Educator', 'Gambling Disorder Support Navigator',
    'Addiction Medicine Research Trial Educator',
  ]);

  addMedical('medical-medical-toxicology', 'Medical · Medical Toxicology', [
    'Medical Toxicology Poison Exposure Educator', 'Overdose Reversal & Aftercare Coach', 'Household Chemical Exposure Advisor',
    'Lead & Heavy Metal Screening Educator', 'Carbon Monoxide Poisoning Prevention Coach', 'Snake & Spider Envenomation First Aid Educator',
    'Medication Error Toxicology Advisor', 'Alcohol Toxicity Emergency Literacy Coach', 'Recreational Drug Adulterant Educator',
    'Workplace Chemical Spill Response Advisor', 'Pesticide Exposure Home Educator', 'Button Battery Ingestion Emergency Coach',
    'Mushroom Foraging Poisoning Educator', 'Shellfish & Food Toxin Advisor', 'Radiation Exposure Public Health Educator',
    'Pediatric Ingestion Prevention Coach', 'Antidote Availability Navigator', 'Poison Center Hotline Usage Educator',
    'Environmental Toxin Screening Advisor', 'Chelation Therapy Literacy Coach', 'Toxicology Lab Interpretation Educator',
    'Disaster Chemical Release Community Advisor',
  ]);

  addMedical('medical-colorectal-surgery', 'Medical · Colon & Rectal Surgery', [
    'Colorectal Surgery Bowel Prep Educator', 'Colon Resection Recovery Coach', 'Ileostomy Appliance Training Advisor',
    'Colostomy Lifestyle Management Educator', 'Hemorrhoid Treatment Options Coach', 'Anal Fissure Healing Educator',
    'Fistula Surgical Pathway Advisor', 'Rectal Cancer Surgery Prep Navigator', 'Low Anterior Resection Syndrome Coach',
    'Pelvic Floor After Colorectal Surgery Educator', 'Pilonidal Disease Care Advisor', 'Diverticulitis Surgery Decision Coach',
    'IBD Surgical Timing Educator', 'Minimally Invasive Colorectal Recovery Advisor', 'ERAS Colorectal Pathway Coach',
    'Stoma Reversal Expectation Educator', 'Anal Cancer Screening Navigator', 'Colorectal Genetics Referral Advisor',
    'Pediatric Colorectal Condition Educator', 'Colorectal Telehealth Follow-Up Coach', 'Bowel Function Rehabilitation Educator',
    'Colorectal Surgery Second Opinion Navigator',
  ]);

  addMedical('medical-thoracic-surgery', 'Medical · Thoracic Surgery', [
    'Thoracic Surgery Lung Resection Educator', 'Esophageal Surgery Recovery Coach', 'Mediastinal Mass Workup Navigator',
    'Lung Cancer Surgical Staging Educator', 'VATS Minimally Invasive Thoracic Coach', 'Chest Tube Home Care Advisor',
    'Thoracic ERAS Recovery Pathway Educator', 'Esophagectomy Nutrition Coach', 'Hiatal Hernia Surgical Options Advisor',
    'Pneumothorax Recurrence Prevention Educator', 'Thoracic Trauma Recovery Coach', 'Lung Volume Reduction Educator',
    'Tracheal Stenosis Treatment Navigator', 'Thoracic Surgery Pain Management Coach', 'Pulmonary Rehab Post-Thoracic Educator',
    'Thoracic Oncology Multidisciplinary Advisor', 'Robotic Thoracic Surgery Expectation Educator', 'Chest Wall Tumor Recovery Coach',
    'Thoracic Surgery Prehab Fitness Advisor', 'Empyema Drainage Literacy Educator', 'Thoracic Second Opinion Navigator',
    'Thoracic Surgery Telehealth Check-In Coach',
  ]);

  addMedical('medical-vascular-surgery', 'Medical · Vascular Surgery', [
    'Vascular Surgery Aneurysm Screening Educator', 'Carotid Stenosis Surgery Decision Coach', 'Peripheral Bypass Recovery Advisor',
    'Varicose Vein Treatment Options Educator', 'Deep Vein Thrombosis Surgical Coach', 'Dialysis Access Fistula Educator',
    'Aortic Dissection Recovery Navigator', 'Diabetic Foot Wound Vascular Advisor', 'Venous Ulcer Compression Coach',
    'Thoracic Outlet Syndrome Educator', 'Vascular Trauma Recovery Advisor', 'Endovascular Stent Graft Educator',
    'Raynaud Phenomenon Vascular Coach', 'Lymphedema Vascular Referral Navigator', 'Vascular Lab Ultrasound Educator',
    'Amputation Prevention Limb Salvage Advisor', 'Vascular Surgery Anticoagulation Coach', 'Carotid Stent vs Endarterectomy Educator',
    'Mesenteric Ischemia Red Flag Advisor', 'Vascular Surgery Prehab Coach', 'Vascular Telehealth Monitoring Educator',
    'Vascular Quality Outcomes Literacy Advisor',
  ]);

  addMedical('medical-neurosurgery', 'Medical · Neurological Surgery', [
    'Neurosurgery Brain Tumor Prep Educator', 'Spine Surgery Expectation Coach', 'Hydrocephalus Shunt Literacy Advisor',
    'Chiari Malformation Educator', 'Trigeminal Neuralgia Surgical Options Coach', 'Aneurysm Clipping vs Coiling Educator',
    'Epilepsy Surgery Candidacy Navigator', 'Pediatric Neurosurgery Family Advisor', 'Spinal Cord Tumor Recovery Coach',
    'Minimally Invasive Spine Educator', 'Cervical Disc Surgery Recovery Advisor', 'Lumbar Fusion Rehab Coach',
    'Peripheral Nerve Surgery Educator', 'Neurosurgical ICU Family Advisor', 'Deep Brain Stimulation Prep Coach',
    'Pituitary Surgery Endonasal Educator', 'Traumatic Brain Injury Surgical Advisor', 'Neurosurgery Second Opinion Navigator',
    'Spine Deformity Scoliosis Educator', 'Neurosurgical Pain Management Coach', 'Neurosurgery Telehealth Follow-Up Advisor',
    'Neurosurgical Clinical Trial Navigator',
  ]);

  addMedical('medical-orthopedic-surgery', 'Medical · Orthopedic Surgery', [
    'Orthopedic Surgery Joint Replacement Educator', 'Hip Replacement Recovery Coach', 'Knee Replacement Rehab Advisor',
    'Shoulder Rotator Cuff Surgery Educator', 'ACL Reconstruction Recovery Coach', 'Fracture Cast & Weight Bearing Advisor',
    'Hand Surgery Recovery Educator', 'Foot & Ankle Surgery Coach', 'Spine Orthopedic Decompression Educator',
    'Sports Medicine Orthopedic Surgical Advisor', 'Pediatric Orthopedic Fracture Educator', 'Arthritis Surgical Timing Coach',
    'Orthopedic Trauma Recovery Navigator', 'Joint Preservation Osteotomy Educator', 'Meniscus Repair vs Removal Advisor',
    'Orthopedic Oncology Limb Salvage Educator', 'Orthopedic ERAS Pathway Coach', 'Orthopedic Implant Metal Allergy Advisor',
    'Orthopedic Telehealth Post-Op Coach', 'Orthopedic Second Opinion Navigator', 'Bone Health Osteoporosis Surgical Educator',
    'Orthopedic Surgery Pain & Opioid Coach',
  ]);

  addMedical('medical-plastic-surgery', 'Medical · Plastic & Reconstructive Surgery', [
    'Plastic Surgery Reconstruction Educator', 'Breast Reconstruction Options Coach', 'Cleft Lip Palate Family Advisor',
    'Burn Reconstruction Expectation Educator', 'Skin Graft Recovery Coach', 'Hand Reconstruction Plastic Surgery Advisor',
    'Facial Trauma Reconstruction Educator', 'Microsurgery Free Flap Recovery Coach', 'Scar Revision Expectation Advisor',
    'Cosmetic Surgery Informed Consent Educator', 'Rhinoplasty Recovery Coach', 'Body Contouring Safety Educator',
    'Gender Affirming Surgery Navigator', 'Pressure Ulcer Reconstruction Advisor', 'Lymphedema Reconstructive Educator',
    'Pediatric Plastic Surgery Family Coach', 'Plastic Surgery Complication Red Flag Educator', 'Non-Surgical Aesthetic Options Advisor',
    'Plastic Surgery Photo Documentation Educator', 'Reconstructive Telehealth Follow-Up Coach', 'Plastic Surgery Second Opinion Navigator',
    'Plastic Surgery Research Trial Educator',
  ]);

  addMedical('medical-otolaryngology', 'Medical · Otolaryngology (ENT)', [
    'ENT Hearing Loss Evaluation Educator', 'Tonsillectomy Recovery Coach', 'Sinus Surgery Expectation Advisor',
    'Voice Disorder ENT Educator', 'Sleep Apnea Surgical Options Coach', 'Thyroid Surgery ENT Educator',
    'Salivary Gland Disorder Advisor', 'Ear Tube Placement Pediatric Educator', 'Vertigo ENT Evaluation Coach',
    'Head & Neck Cancer ENT Navigator', 'Cochlear Implant Candidacy Educator', 'Nasal Obstruction Surgical Advisor',
    'Laryngectomy Communication Coach', 'Pediatric ENT Airway Educator', 'Allergic Rhinitis ENT Management Coach',
    'ENT Trauma Facial Fracture Advisor', 'Swallowing Disorder ENT Educator', 'ENT Telehealth Triage Coach',
    'ENT Second Opinion Navigator', 'Smell & Taste Loss Educator', 'ENT Clinical Research Trial Advisor',
    'ENT Post-Op Bleeding Red Flag Educator',
  ]);

  addMedical('medical-urology-specialty', 'Medical · Urology', [
    'Urology Prostate Health Educator', 'Kidney Stone Prevention Coach', 'BPH Surgical Options Advisor',
    'Bladder Cancer Screening Navigator', 'Urinary Incontinence Management Educator', 'Erectile Dysfunction Urology Coach',
    'Male Infertility Urology Advisor', 'Vasectomy Expectation Educator', 'Interstitial Cystitis Support Coach',
    'Urologic Oncology Treatment Pathway Educator', 'Pediatric Urology Hypospadias Advisor', 'Neurogenic Bladder Educator',
    'Urethral Stricture Treatment Navigator', 'Testicular Cancer Self-Exam Educator', 'Urology Catheter Care Coach',
    'Pelvic Floor Urology Referral Advisor', 'Urologic Trauma Recovery Educator', 'Urology Telehealth Follow-Up Coach',
    'Urology Second Opinion Navigator', 'Overactive Bladder Medication Educator', 'Urology ERAS Surgical Coach',
    'Urology Clinical Trial Navigator',
  ]);

  addMedical('medical-ophthalmology-specialty', 'Medical · Ophthalmology', [
    'Ophthalmology Cataract Surgery Educator', 'Glaucoma Eye Drop Technique Coach', 'Macular Degeneration Monitoring Advisor',
    'Diabetic Retinopathy Screening Educator', 'Dry Eye Comprehensive Management Coach', 'Refractive Surgery LASIK Educator',
    'Pediatric Strabismus Family Advisor', 'Corneal Transplant Expectation Coach', 'Retinal Detachment Red Flag Educator',
    'Uveitis Inflammatory Eye Disease Advisor', 'Low Vision Rehabilitation Navigator', 'Ocular Trauma First Aid Educator',
    'Contact Lens Safety Coach', 'Ophthalmic Oncology Navigator', 'Neuro-Ophthalmology Double Vision Educator',
    'Eyelid Surgery Blepharoplasty Advisor', 'Ophthalmology Telemedicine Screening Coach', 'Eye Emergency Triage Educator',
    'Ophthalmology Second Opinion Navigator', 'Color Blindness Workplace Advisor', 'Ophthalmic Clinical Trial Educator',
    'Post-Cataract Activity Restriction Coach',
  ]);

  addMedical('medical-interventional-radiology', 'Medical · Interventional Radiology', [
    'Interventional Radiology Procedure Prep Educator', 'Angiography Vascular Access Coach', 'Embolization Therapy Educator',
    'Tumor Ablation IR Advisor', 'Biopsy Image-Guided Prep Coach', 'Drain Placement IR Educator',
    'Venous Access Port Placement Advisor', 'Uterine Fibroid Embolization Educator', 'Varicose Vein Ablation IR Coach',
    'Dialysis Access IR Intervention Educator', 'Spine Vertebroplasty Advisor', 'Biliary Drain IR Educator',
    'IR Pain Procedure Expectation Coach', 'Pediatric IR Sedation Educator', 'IR Contrast Allergy Prep Advisor',
    'Post-IR Bleeding Watch Educator', 'IR Clinical Trial Navigator', 'IR Telehealth Follow-Up Coach',
    'IR Second Opinion Navigator', 'Deep Vein Thrombosis Thrombectomy Educator', 'GI Bleed Embolization Literacy Coach',
    'IR Radiation Safety Patient Educator',
  ]);

  addMedical('medical-radiation-oncology', 'Medical · Radiation Oncology', [
    'Radiation Oncology Treatment Planning Educator', 'External Beam Radiation Expectation Coach', 'Brachytherapy Procedure Advisor',
    'Stereotactic Radiosurgery Educator', 'Radiation Skin Care Coach', 'Fatigue During Radiation Educator',
    'Radiation & Nutrition Advisor', 'Pediatric Radiation Family Navigator', 'Prostate Radiation Side Effect Coach',
    'Breast Radiation Skin Management Educator', 'Head Neck Radiation Swallowing Advisor', 'Lung Radiation Pneumonitis Educator',
    'Radiation Immune Checkpoint Timing Coach', 'Palliative Radiation Pain Educator', 'Radiation Fertility Preservation Advisor',
    'Radiation Second Opinion Navigator', 'Proton Therapy Literacy Educator', 'Radiation Clinical Trial Navigator',
    'Radiation Telehealth On-Treatment Coach', 'Radiation Myths & Safety Educator', 'Re-Irradiation Decision Literacy Advisor',
    'Radiation Oncology Survivorship Educator',
  ]);

  addMedical('medical-geriatric-medicine', 'Medical · Geriatric Medicine', [
    'Geriatric Medicine Comprehensive Assessment Educator', 'Falls Prevention Geriatric Coach', 'Polypharmacy Deprescribing Advisor',
    'Dementia Behavioral Management Educator', 'Delirium Prevention Hospital Coach', 'Geriatric Frailty Screening Advisor',
    'Advance Care Planning Geriatric Facilitator', 'Geriatric Nutrition & Sarcopenia Educator', 'Urinary Incontinence Geriatric Coach',
    'Geriatric Depression Screening Advisor', 'Elder Abuse Recognition Educator', 'Geriatric Mobility Device Coach',
    'Senior Living Level of Care Navigator', 'Geriatric Telehealth Monitoring Educator', 'Geriatric Palliative Integration Advisor',
    'Hearing Vision Sensory Geriatric Coach', 'Geriatric Cardiovascular Risk Educator', 'Osteoporosis Fracture Geriatric Advisor',
    'Geriatric Caregiver Support Educator', 'Transitions of Care Geriatric Coach', 'Geriatric Clinical Trial Navigator',
    'Geriatric Quality of Life Assessment Educator',
  ]);

  addMedical('medical-adolescent-medicine', 'Medical · Adolescent Medicine', [
    'Adolescent Medicine Confidentiality Educator', 'Teen Reproductive Health Advisor', 'Adolescent Eating Disorder Navigator',
    'Teen Mental Health Screening Coach', 'Adolescent Substance Use Brief Intervention Educator', 'LGBTQ+ Youth Health Advisor',
    'Teen Sports Physical Educator', 'Adolescent Chronic Illness Transition Coach', 'Teen Vaccine Education Advisor',
    'Adolescent Sleep & Screen Time Coach', 'Teen Acne & Dermatology Referral Educator', 'Adolescent Obesity Lifestyle Advisor',
    'Teen Menstrual Health Educator', 'Adolescent Injury Prevention Coach', 'School-Based Health Center Liaison Educator',
    'Teen Anxiety Depression Resource Navigator', 'Adolescent Telehealth Engagement Coach', 'Teen Driver Safety Health Advisor',
    'Adolescent Clinical Research Educator', 'Teen Parent Support Navigator', 'Adolescent Gender-Affirming Care Literacy Advisor',
    'College Health Transition Educator',
  ]);

  addMedical('medical-occupational-medicine', 'Medical · Occupational Medicine', [
    'Occupational Medicine Fitness for Duty Educator', 'Workplace Injury Evaluation Coach', 'Return-to-Work Medical Advisor',
    'Workers Compensation Medical Navigator', 'Occupational Exposure Assessment Educator', 'OSHA Medical Surveillance Coach',
    'Hearing Conservation Medical Advisor', 'Respirator Medical Clearance Educator', 'Shift Work Disorder Occupational Coach',
    'Ergonomic Injury Prevention Medical Advisor', 'Toxic Exposure Workplace Educator', 'Travel Occupational Health Advisor',
    'Healthcare Worker Immunity & Vaccine Coach', 'Office Ergonomic Medical Advisor', 'Construction Medical Surveillance Educator',
    'Firefighter Medical Standards Coach', 'Pilot FAA Medical Certification Educator', 'Commercial Driver DOT Physical Advisor',
    'Occupational Dermatitis Educator', 'Bloodborne Pathogen Occupational Coach', 'Occupational Telehealth Case Advisor',
    'Occupational Medicine Disability Evaluation Educator',
  ]);

  addMedical('medical-sports-medicine-physician', 'Medical · Sports Medicine (Physician)', [
    'Sports Medicine Concussion Protocol Educator', 'ACL Injury Prevention Coach', 'Return-to-Play Cardiac Screening Advisor',
    'Sports Hernia Evaluation Educator', 'Overuse Injury Load Management Coach', 'Sports Nutrition Physician Advisor',
    'Exercise-Induced Asthma Sports Educator', 'Heat Illness Athletic Team Advisor', 'Female Athlete Triad Educator',
    'Sports Medicine Ultrasound Literacy Coach', 'Throwing Injury Baseball Educator', 'Running Injury Gait Advisor',
    'Cycling Overuse Injury Coach', 'Sports Medicine Injection Options Educator', 'Adolescent Sports Injury Advisor',
    'Masters Athlete Health Coach', 'Sports Medicine Telehealth Triage Educator', 'Adaptive Sports Medicine Advisor',
    'Sports Physical Performance Health Educator', 'Team Physician Sideline Emergency Coach', 'Sports Medicine Research Trial Navigator',
    'Esports Medicine Ergonomic Health Advisor',
  ]);

  addMedical('medical-podiatry', 'Medical · Podiatry', [
    'Podiatry Diabetic Foot Care Educator', 'Ingrown Toenail Treatment Coach', 'Plantar Fasciitis Stretching Advisor',
    'Bunion Surgical Options Educator', 'Heel Pain Biomechanics Coach', 'Ankle Sprain Rehab Podiatry Advisor',
    'Custom Orthotic Prescription Educator', 'Fungal Nail Infection Coach', 'Peripheral Neuropathy Foot Screening Advisor',
    'Wound Care Podiatry Educator', 'Sports Podiatry Injury Coach', 'Pediatric Flatfoot Educator',
    'Geriatric Fall Risk Footwear Advisor', 'Podiatry Nail Surgery Expectation Coach', 'Charcot Foot Emergency Educator',
    'Podiatry Telehealth Triage Advisor', 'Foot Ulcer Offloading Educator', 'Podiatry Second Opinion Navigator',
    'Toe Deformity Hammertoe Advisor', 'Podiatry Clinical Research Educator', 'Foot & Ankle Arthritis Surgical Coach',
    'Podiatry Preventive Screening Educator',
  ]);

  addMedical('medical-optometry', 'Medical · Optometry', [
    'Optometry Comprehensive Eye Exam Educator', 'Prescription Eyewear Lens Options Coach', 'Contact Lens Fitting Safety Advisor',
    'Dry Eye Optometry Management Educator', 'Myopia Control Pediatric Coach', 'Glaucoma Optometry Co-Management Advisor',
    'Diabetic Eye Exam Optometry Educator', 'Low Vision Optometry Device Coach', 'Occupational Vision Ergonomics Advisor',
    'Sports Vision Performance Educator', 'Color Vision Deficiency Workplace Coach', 'Binocular Vision Therapy Educator',
    'Optometry Telehealth Visual Acuity Coach', 'Senior Driving Vision Safety Advisor', 'Blue Light & Digital Eye Strain Educator',
    'Optometry Urgent Red Eye Triage Coach', 'Foreign Body Eye First Aid Educator', 'Optometry Billing Insurance Navigator',
    'Optometry Clinical Research Educator', 'Orthokeratology Night Lens Advisor', 'Vision Therapy Learning Disability Coach',
    'Optometry Community Screening Program Designer',
  ]);

  addMedical('medical-audiology', 'Medical · Audiology', [
    'Audiology Hearing Test Explainer', 'Hearing Aid Selection & Fitting Coach', 'Cochlear Implant Candidacy Audiologist Educator',
    'Tinnitus Sound Therapy Advisor', 'Pediatric Hearing Screening Coach', 'Noise-Induced Hearing Loss Prevention Educator',
    'Vestibular Balance Audiologist Advisor', 'Central Auditory Processing Educator', 'Assistive Listening Device Coach',
    'Audiology Telehealth Hearing Care Advisor', 'Hearing Aid Maintenance & Troubleshooting Educator', 'Sudden Hearing Loss Urgent Navigator',
    'Audiology Occupational Hearing Conservation Coach', 'Musician Hearing Protection Advisor', 'Aging Hearing Communication Strategies Educator',
    'Auditory Neuropathy Family Navigator', 'Bone Anchored Hearing System Educator', 'Audiology Clinical Research Advisor',
    'Hearing Aid Financial Assistance Navigator', 'Audiology School IEP Liaison Educator', 'Single-Sided Deafness Options Coach',
    'Audiology Community Outreach Screening Facilitator',
  ]);

  addMedical('medical-chiropractic', 'Medical · Chiropractic & Spinal Care', [
    'Chiropractic Low Back Pain Educator', 'Neck Pain Chiropractic Safety Coach', 'Sciatica Conservative Care Advisor',
    'Chiropractic Posture Ergonomic Educator', 'Sports Chiropractic Injury Coach', 'Pediatric Chiropractic Gentle Care Advisor',
    'Pregnancy Chiropractic Comfort Educator', 'Chiropractic vs Medical Referral Navigator', 'Spinal Manipulation Expectation Coach',
    'Chiropractic Maintenance Care Educator', 'Whiplash Recovery Chiropractic Advisor', 'Headache Cervicogenic Chiropractic Coach',
    'Chiropractic X-Ray Literacy Educator', 'Chiropractic Telehealth Exercise Advisor', 'Scoliosis Conservative Monitoring Coach',
    'Chiropractic Informed Consent Educator', 'Chiropractic Research Evidence Literacy Advisor', 'Workplace Spinal Health Coach',
    'Chiropractic Integrative Care Navigator', 'Chiropractic Red Flag Referral Educator', 'Chiropractic Rehabilitation Exercise Coach',
    'Chiropractic Insurance Coverage Navigator',
  ]);

  addMedical('medical-genetic-counseling', 'Medical · Genetic Counseling', [
    'Genetic Counseling Hereditary Cancer Coach', 'Prenatal Genetic Screening Navigator', 'Carrier Screening Couple Educator',
    'Chromosomal Abnormality Result Counselor Educator', 'Pharmacogenomic Counseling Advisor', 'Adoption Genetic History Educator',
    'Direct-to-Consumer Test Follow-Up Coach', 'Genetic Counseling Informed Consent Educator', 'Family Pedigree Literacy Advisor',
    'Genetic Discrimination GINA Rights Educator', 'Rare Disease Genetic Counseling Navigator', 'Recurrent Pregnancy Loss Genetics Coach',
    'Genetic Counseling Telehealth Session Advisor', 'Pediatric Genetic Counseling Family Educator', 'Cancer Risk Reduction Planning Coach',
    'Genetic Counseling Research Study Navigator', 'Genetic Counseling Bereavement Support Advisor', 'Genetic Counseling Cultural Competency Educator',
    'Whole Genome Result Disclosure Coach', 'Genetic Counseling Insurance Authorization Navigator', 'Genetic Counseling Ethics Case Educator',
    'Genetic Counseling Career Path Advisor',
  ]);

  addMedical('medical-clinical-dietetics', 'Medical · Clinical Dietetics & Nutrition', [
    'Clinical Dietitian Renal Nutrition Educator', 'Diabetes Medical Nutrition Therapy Coach', 'Oncology Nutrition During Treatment Advisor',
    'GI Disorder Diet Educator', 'Eating Disorder Recovery Nutrition Coach', 'Pediatric Nutrition Growth Advisor',
    'Sports Nutrition Performance Dietitian Educator', 'Weight Management Dietitian Coach', 'Tube Feeding Nutrition Educator',
    'Food Allergy Elimination Diet Advisor', 'Bariatric Surgery Nutrition Coach', 'Pregnancy Lactation Nutrition Educator',
    'Dysphagia Texture Modified Diet Coach', 'Malnutrition Hospital Nutrition Advisor', 'Plant-Based Nutrition Clinical Educator',
    'Intuitive Eating Health At Every Size Advisor', 'Dietitian Telehealth Meal Planning Coach', 'Nutrition Label Literacy Educator',
    'Clinical Dietitian Research Trial Advisor', 'Home Enteral Nutrition Supply Navigator', 'ICU Nutrition Support Educator',
    'Community Nutrition Program Designer',
  ]);

  addMedical('medical-ems-paramedic', 'Medical · EMS & Prehospital Care', [
    'Paramedic Triage Field Educator', 'EMS Stroke Prehospital Coach', 'Cardiac Arrest Chain of Survival Educator',
    'Trauma Scene Safety EMS Advisor', 'Pediatric EMS Protocol Educator', 'Geriatric Fall EMS Assessment Coach',
    'Overdose Response Naloxone EMS Educator', 'Airway Management EMS Skills Trainer', 'EMS Disaster Response Planner',
    'Community Paramedicine Home Visit Educator', 'EMS Mental Health Crisis Response Coach', 'Tactical EMS Operations Advisor',
    'Flight Paramedic Transport Educator', 'EMS Quality Improvement Coach', 'Ambulance Billing & Insurance Navigator',
    'EMS Continuing Education Coordinator', 'Stop the Bleed Public Training Facilitator', 'EMS Infection Control Educator',
    'Rural EMS Resource Navigation Advisor', 'EMS Telemedicine Physician Consult Coach', 'Mass Gathering Medical Planning Educator',
    'EMS Research & Protocol Development Advisor',
  ]);

  addMedical('medical-cardiovascular-perfusion', 'Medical · Cardiovascular Perfusion', [
    'Cardiovascular Perfusion Bypass Educator', 'Heart-Lung Machine Family Explainer', 'ECMO Circuit Literacy Coach',
    'Pediatric Perfusion Family Advisor', 'Perfusion Anticoagulation Monitoring Educator', 'Cardiac Surgery Blood Conservation Coach',
    'Intra-Aortic Balloon Pump Educator', 'Ventricular Assist Device Perfusion Advisor', 'Organ Procurement Perfusion Navigator',
    'Perfusion Quality Assurance Educator', 'Perfusionist Career Path Advisor', 'Cardiopulmonary Bypass Complication Educator',
    'Perfusion Equipment Maintenance Coach', 'Transplant Organ Perfusion Educator', 'Perfusion Crisis Resource Management Trainer',
    'Perfusion Tele-simulation Educator', 'Perfusion Research Protocol Advisor', 'Minimally Invasive Perfusion Techniques Coach',
    'Perfusion Lab Safety Educator', 'Perfusion Continuing Competency Coach', 'Perfusion Documentation Standards Educator',
    'Perfusion Team Communication Advisor',
  ]);

  addMedical('medical-health-social-work', 'Medical · Health Social Work', [
    'Hospital Social Work Discharge Planner', 'Medical Social Work Care Navigation Educator', 'Cancer Social Work Support Coach',
    'Dialysis Social Work Benefits Advisor', 'Transplant Social Work Psychosocial Educator', 'Pediatric Hospital Social Work Navigator',
    'Geriatric Social Work Community Resource Coach', 'Mental Health Medical Social Work Advisor', 'Substance Use Social Work Referral Educator',
    'Domestic Violence Medical Social Work Navigator', 'Housing Instability Health Social Work Coach', 'Insurance Authorization Social Work Educator',
    'Advance Directives Social Work Facilitator', 'Bereavement Medical Social Work Advisor', 'Chronic Disease Social Work Coach',
    'Social Work Telehealth Resource Navigator', 'Medical Foster Care Social Work Educator', 'NICU Family Social Work Advisor',
    'Social Work Ethics & Boundaries Educator', 'Medical Social Work Documentation Coach', 'Community Health Social Work Liaison Educator',
    'Social Work Clinical Supervision Advisor',
  ]);

  addMedical('medical-pediatric-subspecialties', 'Medical · Pediatric Subspecialties', [
    'Pediatric Cardiology Family Educator', 'Pediatric Endocrinology Growth Coach', 'Pediatric Gastroenterology Nutrition Advisor',
    'Pediatric Hematology Oncology Navigator', 'Pediatric Nephrology Dialysis Educator', 'Pediatric Pulmonology Asthma Coach',
    'Pediatric Rheumatology JIA Educator', 'Pediatric Infectious Disease Advisor', 'Pediatric Neurology Epilepsy Coach',
    'Pediatric Genetics Syndrome Navigator', 'Pediatric Allergy Immunology Educator', 'Pediatric Critical Care Family Advisor',
    'Pediatric Surgery Expectation Coach', 'Pediatric Urology Educator', 'Pediatric Orthopedic Scoliosis Advisor',
    'Pediatric ENT Tonsil Educator', 'Pediatric Ophthalmology Strabismus Coach', 'Pediatric Dermatology Eczema Educator',
    'Pediatric Sleep Medicine Coach', 'Pediatric Subspecialty Palliative Navigator', 'Pediatric Rehab Medicine Educator',
    'Pediatric Hospital Medicine Transition Coach',
  ]);

  addMedical('medical-integrative-medicine', 'Medical · Integrative & Complementary Health', [
    'Integrative Medicine Whole-Person Educator', 'Acupuncture Evidence Literacy Coach', 'Mindfulness-Based Stress Reduction Advisor',
    'Herbal Supplement Interaction Educator', 'Integrative Oncology Support Coach', 'Functional Medicine Root Cause Educator',
    'Yoga Therapy Clinical Referral Advisor', 'Integrative Pain Management Coach', 'Traditional Chinese Medicine Literacy Educator',
    'Ayurveda Wellness Cultural Advisor', 'Integrative Mental Health Coach', 'Naturopathic Medicine Scope Educator',
    'Integrative Cardiovascular Lifestyle Advisor', 'Integrative GI Microbiome Educator', 'Integrative Sleep Program Designer',
    'Integrative Women\'s Health Coach', 'Integrative Pediatrics Safety Educator', 'Integrative Medicine Research Navigator',
    'Integrative Telehealth Coaching Advisor', 'Integrative Medicine Informed Consent Educator', 'Integrative Chronic Fatigue Coach',
    'Integrative Medicine Hospital Program Designer',
  ]);

  addMedical('medical-oral-maxillofacial-surgery', 'Medical · Oral & Maxillofacial Surgery', [
    'Oral Surgery Wisdom Teeth Educator', 'Jaw Surgery Orthognathic Coach', 'Dental Implant Surgical Advisor',
    'TMJ Surgical Options Educator', 'Oral Pathology Biopsy Navigator', 'Facial Fracture Oral Surgery Coach',
    'Cleft Jaw Surgery Family Educator', 'Oral Cancer Surgical Navigator', 'Sleep Apnea Jaw Advancement Advisor',
    'Oral Surgery Sedation Options Educator', 'Bone Graft Oral Surgery Coach', 'Salivary Gland Stone Surgery Educator',
    'Pediatric Oral Surgery Anxiety Coach', 'Oral Surgery Post-Op Bleeding Educator', 'Orthognathic Insurance Authorization Navigator',
    'Oral Surgery Telehealth Follow-Up Advisor', 'Dental Trauma Emergency Oral Surgery Coach', 'Oral Surgery Second Opinion Navigator',
    'Maxillofacial Reconstruction Educator', 'Oral Surgery Clinical Research Advisor', 'Temporomandibular Surgical Rehab Coach',
    'Oral Surgery Antibiotic Prophylaxis Educator',
  ]);

  addMedical('medical-pediatric-surgery', 'Medical · Pediatric Surgery', [
    'Pediatric Surgery Hernia Educator', 'Congenital Diaphragmatic Hernia Family Coach', 'Pyloric Stenosis Surgical Advisor',
    'Appendicitis Pediatric Surgery Educator', 'Pediatric Trauma Surgery Navigator', 'Neonatal Surgical Condition Coach',
    'Pediatric Oncology Surgical Educator', 'Pediatric Urology Surgery Advisor', 'Pediatric ENT Surgical Referral Coach',
    'Pediatric Minimal Access Surgery Educator', 'Pediatric Surgical Consent Family Coach', 'Pediatric Pre-Op Anxiety Educator',
    'Pediatric Post-Op Pain Management Coach', 'Pediatric Surgical Nutrition Advisor', 'Pediatric Surgical ICU Family Educator',
    'Pediatric Surgical Second Opinion Navigator', 'Pediatric Surgical Telehealth Follow-Up Coach', 'Pediatric Surgical Research Trial Educator',
    'Pediatric Surgical Wound Care Advisor', 'Pediatric Surgical Scar Management Coach', 'Pediatric Surgical Antibiotic Stewardship Educator',
    'Pediatric Surgical Quality Outcomes Advisor',
  ]);

  addMedical('medical-surgical-oncology', 'Medical · Surgical Oncology', [
    'Surgical Oncology Breast Educator', 'Melanoma Surgical Staging Coach', 'Sarcoma Surgical Referral Navigator',
    'Hepatobiliary Surgical Oncology Educator', 'Pancreatic Surgical Oncology Coach', 'Colorectal Surgical Oncology Advisor',
    'Thyroid Surgical Oncology Educator', 'Gastric Surgical Oncology Navigator', 'Ovarian Debulking Surgery Educator',
    'Sentinel Lymph Node Surgical Coach', 'Surgical Oncology Multidisciplinary Tumor Board Educator', 'HIPEC Cytoreductive Surgery Advisor',
    'Surgical Oncology Clinical Trial Navigator', 'Perioperative Oncology Nutrition Coach', 'Surgical Oncology Survivorship Educator',
    'Reconstructive Oncologic Surgery Advisor', 'Surgical Oncology Second Opinion Navigator', 'Minimally Invasive Oncologic Surgery Coach',
    'Surgical Oncology ERAS Pathway Educator', 'Oncologic Emergency Surgery Literacy Advisor', 'Surgical Oncology Telehealth Follow-Up Coach',
    'Surgical Oncology Quality Metrics Educator',
  ]);

  addMedical('medical-transplant-medicine', 'Medical · Transplant Medicine', [
    'Organ Transplant Evaluation Educator', 'Kidney Transplant Living Donor Coach', 'Liver Transplant MELD Score Educator',
    'Heart Transplant Candidacy Navigator', 'Lung Transplant Referral Advisor', 'Pancreas Transplant Diabetes Educator',
    'Transplant Bone Marrow Recovery Educator', 'Transplant Immunosuppression Medication Coach', 'Transplant Rejection Warning Sign Educator',
    'Transplant Infectious Disease Prevention Advisor', 'Pediatric Transplant Family Navigator', 'Transplant Psychosocial Assessment Coach',
    'Transplant Financial Coordinator Educator', 'Transplant Lifestyle Infection Avoidance Advisor', 'Transplant Telehealth Monitoring Coach',
    'Transplant Clinical Trial Navigator', 'Transplant Ethics & Allocation Educator', 'Transplant Recovery Nutrition Coach',
    'Transplant Exercise Rehabilitation Advisor', 'Transplant Second Opinion Navigator', 'Transplant Donor Registry Educator',
    'Transplant Quality Outcomes Literacy Advisor',
  ]);

  addMedical('medical-reproductive-endocrinology', 'Medical · Reproductive Endocrinology & Infertility', [
    'Infertility Workup Educator', 'IVF Cycle Preparation Coach', 'Ovulation Induction Medication Advisor',
    'Male Factor Infertility Navigator', 'Recurrent Pregnancy Loss REI Educator', 'PCOS Fertility Treatment Coach',
    'Endometriosis Fertility Surgical Advisor', 'Egg Freezing Preservation Educator', 'Donor Egg & Sperm Literacy Coach',
    'Surrogacy Legal Medical Navigator', 'Fertility Hormone Injection Training Educator', 'IVF Embryo Transfer Prep Coach',
    'Fertility Genetic Testing PGT Educator', 'LGBTQ+ Family Building REI Advisor', 'Fertility Clinic Financial Navigator',
    'Oncofertility REI Urgent Referral Coach', 'Fertility Telehealth Monitoring Educator', 'Fertility Second Opinion Navigator',
    'Fertility Research Trial Educator', 'Fertility Mental Health Support Advisor', 'Fertility Acupuncture Integrative Coach',
    'Fertility Outcomes Statistics Literacy Educator',
  ]);

  return defs;
}
