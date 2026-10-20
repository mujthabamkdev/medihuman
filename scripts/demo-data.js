/**
 * Realistic demo dataset for MediHuman.
 *
 * The content mirrors how the app is actually used: a patient keeps a home
 * medicine list, records the prescription they received, and compares the two
 * names to spot what the pharmacy did or did not dispense. Clinicians then
 * request access, read the approved record, and leave indications.
 *
 * Every account is fictional and uses example.com addresses. Nothing here is
 * real patient data, and no real clinical decision should be based on it.
 */
import { compareMedicines } from '../src/medication-logic.js';

export const DEMO_PASSWORD = 'MediHuman@2026';
export const DEMO_DOMAIN = 'example.com';

const DAY = 24 * 60 * 60 * 1000;

function dateOnly(daysFromNow, now) {
  return new Date(now + daysFromNow * DAY).toISOString().slice(0, 10);
}

function timeAgo(days, now, hours = 9) {
  const date = new Date(now - days * DAY);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

const DOCTORS = [
  {
    key: 'rao',
    id: 'demo-doctor-ananya-rao',
    email: 'ananya.rao@clinic.example.com',
    displayName: 'Dr. Ananya Rao',
    specialty: 'General Medicine',
    registrationId: 'KMC-44821',
    organization: 'Sankara Health City, Bengaluru',
    verificationStatus: 'verified',
  },
  {
    key: 'shetty',
    id: 'demo-doctor-vikram-shetty',
    email: 'vikram.shetty@clinic.example.com',
    displayName: 'Dr. Vikram Shetty',
    specialty: 'Cardiology',
    registrationId: 'KMC-51203',
    organization: 'Aster Speciality Hospital, Bengaluru',
    verificationStatus: 'verified',
  },
  {
    key: 'iyer',
    id: 'demo-doctor-meera-iyer',
    email: 'meera.iyer@clinic.example.com',
    displayName: 'Dr. Meera Iyer',
    specialty: 'Endocrinology and Diabetology',
    registrationId: 'TNMC-33917',
    organization: 'Apollo Health City, Chennai',
    verificationStatus: 'verified',
  },
  {
    key: 'gupta',
    id: 'demo-doctor-rohan-gupta',
    email: 'rohan.gupta@clinic.example.com',
    displayName: 'Dr. Rohan Gupta',
    specialty: 'Psychiatry',
    registrationId: 'KMC-57304',
    organization: 'Mindful Care Clinic, Bengaluru',
    verificationStatus: 'pending',
  },
];

const PATIENTS = [
  {
    key: 'ramesh',
    id: 'demo-patient-ramesh-kumar',
    patientId: 'pid-7c1d4a92',
    email: 'ramesh.kumar@example.com',
    fullName: 'Ramesh Kumar',
    dateOfBirth: '1964-02-14',
    allergies: 'Penicillin — rash in childhood',
    conditions: 'Type 2 diabetes mellitus (since 2015), Hypertension',
    doctorKey: 'rao',
    medicines: [
      { name: 'Metformin', strength: '500 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily after meals', notes: 'With food to reduce stomach upset' },
      { name: 'Telmisartan', strength: '40 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Report dizziness or ankle swelling' },
      { name: 'Atorvastatin', strength: '10 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily at bedtime', notes: 'Repeat lipid profile in 3 months' },
    ],
    prescriptions: [
      { medicationName: 'Metformin', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily after meals', startDate: -90, endDate: 275, instructions: 'Continue the current dose. Bring the home readings to the monthly review.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Telmisartan', strength: '40 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -90, endDate: 275, instructions: 'Take in the morning. Report dizziness, unusual thirst, or ankle swelling.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Atorvastatin', strength: '10 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at bedtime', startDate: -45, endDate: 320, instructions: 'Continue. Repeat the lipid profile before the next review.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Glimepiride', strength: '1 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily with breakfast', startDate: -12, endDate: 53, instructions: 'Started for post-meal glucose spikes. Do not start until the pharmacist confirms supply and the start date.', prescriber: 'Dr. Ananya Rao' },
    ],
    reconciliation: {
      prescribed: ['Metformin 500 mg', 'Telmisartan 40 mg', 'Atorvastatin 10 mg', 'Glimepiride 1 mg'],
      dispensed: ['Metformin 500 mg', 'Telmisartan 40 mg', 'Atorvastatin 10 mg', 'Paracetamol 500 mg'],
      notes: 'Glimepiride 1 mg was out of stock at the pharmacy on the collection date. Paracetamol 500 mg was bought over the counter for knee pain — confirm it is safe alongside the current regimen.',
    },
    indications: [
      { title: 'Start Glimepiride only after the pharmacy confirms supply', detail: 'The comparison shows Glimepiride 1 mg was prescribed but not dispensed. Please start it from the first collection where it is in stock, and note the start date.', severity: 'review' },
      { title: 'Paracetamol bought over the counter', detail: 'Paracetamol 500 mg is not part of this plan. Keep taking it for knee pain only after a pharmacist confirms it fits with your diabetes and blood pressure treatment.', severity: 'info' },
    ],
    medicalRecords: [
      { type: 'lab_report', title: 'HbA1c and lipid profile', daysAgo: 45, description: 'HbA1c 7.4%, Total cholesterol 182 mg/dL, LDL 110 mg/dL, HDL 42 mg/dL, Triglycerides 168 mg/dL.', tags: ['diabetes', 'lipids'], source: 'lab', mimeType: 'application/pdf' },
      { type: 'lab_report', title: 'Fasting glucose and renal function', daysAgo: 12, description: 'Fasting glucose 138 mg/dL, Creatinine 0.9 mg/dL, eGFR 82 mL/min/1.73m².', tags: ['diabetes', 'kidney'], source: 'lab', mimeType: 'application/pdf' },
      { type: 'imaging', title: 'Chest X-ray (PA view)', daysAgo: 60, description: 'No cardiomegaly. Lung fields clear. No pleural effusion.', tags: ['chest', 'xray'], source: 'clinic', mimeType: 'image/jpeg' },
      { type: 'clinical_note', title: 'Annual diabetes review', daysAgo: 30, description: 'Blood pressure 138/86. Foot exam normal. No retinopathy on fundus exam. Medication adherence good.', tags: ['review', 'diabetes'], source: 'clinic' },
      { type: 'vaccination', title: 'Influenza vaccine (2025)', daysAgo: 90, description: 'Annual influenza vaccination administered.', tags: ['vaccine', 'flu'], source: 'clinic' },
    ],
  },
  {
    key: 'sunita',
    id: 'demo-patient-sunita-devi',
    patientId: 'pid-b3e75c10',
    email: 'sunita.devi@example.com',
    fullName: 'Sunita Devi',
    dateOfBirth: '1979-09-03',
    allergies: 'Sulfonamides — rash',
    conditions: 'Hypothyroidism (Hashimoto’s), Anaemia',
    doctorKey: 'iyer',
    medicines: [
      { name: 'Levothyroxine', strength: '50 mcg', dose: '1 tablet', route: 'Oral', timing: 'Once daily before breakfast', notes: 'Empty stomach, 30 minutes before food' },
      { name: 'Ferrous Sulphate', strength: '200 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily with vitamin C', notes: 'May cause dark stools' },
      { name: 'Calcium Carbonate', strength: '500 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily at bedtime', notes: 'At least 4 hours apart from levothyroxine' },
    ],
    prescriptions: [
      { medicationName: 'Levothyroxine', strength: '50 mcg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily before breakfast', startDate: -120, endDate: 245, instructions: 'Take on an empty stomach. Separate calcium by at least four hours.', prescriber: 'Dr. Meera Iyer' },
      { medicationName: 'Ferrous Sulphate', strength: '200 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startDate: -40, endDate: 325, instructions: 'Continue for three months, then repeat the haemoglobin test.', prescriber: 'Dr. Meera Iyer' },
      { medicationName: 'Calcium Carbonate', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at bedtime', startDate: -40, endDate: 325, instructions: 'Take at bedtime, away from the thyroid tablet.', prescriber: 'Dr. Meera Iyer' },
    ],
    reconciliation: {
      prescribed: ['Levothyroxine 50 mcg', 'Ferrous Sulphate 200 mg', 'Calcium Carbonate 500 mg'],
      dispensed: ['Thyronorm 50 mcg', 'Ferrous Sulphate 200 mg', 'Calcium Carbonate 500 mg'],
      notes: 'The pharmacy dispensed the brand formulation (Thyronorm) of the same 50 mcg levothyroxine tablet. Confirm the strength and the empty-stomach timing before the next dose.',
    },
    indications: [
      { title: 'Repeat TSH before any dose change', detail: 'The last thyroid panel was seven months ago. Repeat TSH and free T4 before the levothyroxine dose is adjusted at the next visit.', severity: 'review' },
      { title: 'Brand versus generic levothyroxine', detail: 'Your record shows levothyroxine 50 mcg, and the pharmacy dispensed Thyronorm 50 mcg. Please confirm both are the 50 mcg strength and take them the same way.', severity: 'info' },
    ],
    medicalRecords: [
      { type: 'lab_report', title: 'Thyroid panel (TSH, free T4, TPO antibodies)', daysAgo: 200, description: 'TSH 4.8 mIU/L, free T4 1.1 ng/dL, TPO antibodies positive. Consistent with Hashimoto thyroiditis.', tags: ['thyroid', 'labs'], source: 'lab', mimeType: 'application/pdf' },
      { type: 'lab_report', title: 'Complete blood count', daysAgo: 40, description: 'Haemoglobin 10.2 g/dL, MCV 78 fL, ferritin 12 ng/mL. Microcytic hypochromic anaemia.', tags: ['anaemia', 'labs'], source: 'lab', mimeType: 'application/pdf' },
      { type: 'clinical_note', title: 'Endocrinology follow-up', daysAgo: 30, description: 'TSH slightly elevated. Continue current dose. Recheck TSH in 8 weeks. Iron supplementation started.', tags: ['follow-up', 'thyroid'], source: 'clinic' },
    ],
  },
  {
    key: 'joseph',
    id: 'demo-patient-joseph-thomas',
    patientId: 'pid-2fa09d7c',
    email: 'joseph.thomas@example.com',
    fullName: 'Joseph Thomas',
    dateOfBirth: '1953-05-22',
    allergies: 'Codeine — severe nausea and vomiting',
    conditions: 'Coronary artery disease (post myocardial infarction, 2019), Chronic kidney disease stage 2, Hypertension, Type 2 diabetes',
    doctorKey: 'shetty',
    medicines: [
      { name: 'Aspirin', strength: '75 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily after lunch', notes: 'Antiplatelet therapy' },
      { name: 'Clopidogrel', strength: '75 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Dual antiplatelet therapy' },
      { name: 'Atorvastatin', strength: '40 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily at bedtime', notes: 'High-intensity statin' },
      { name: 'Metoprolol', strength: '50 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily with food', notes: 'Do not stop suddenly' },
      { name: 'Ramipril', strength: '5 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Monitor blood pressure and kidney function' },
      { name: 'Ibuprofen', strength: '400 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily with food, when needed for knee pain', notes: 'Purchased over the counter' },
    ],
    prescriptions: [
      { medicationName: 'Aspirin', strength: '75 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily after lunch', startDate: -200, endDate: 165, instructions: 'Continue without interruption.', prescriber: 'Dr. Vikram Shetty' },
      { medicationName: 'Clopidogrel', strength: '75 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -200, endDate: 165, instructions: 'Dual antiplatelet therapy after the 2019 infarct. Do not stop without cardiology advice.', prescriber: 'Dr. Vikram Shetty' },
      { medicationName: 'Atorvastatin', strength: '40 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at bedtime', startDate: -200, endDate: 165, instructions: 'Repeat the lipid profile in 3 months.', prescriber: 'Dr. Vikram Shetty' },
      { medicationName: 'Metoprolol', strength: '50 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily with food', startDate: -95, endDate: 270, instructions: 'Take with breakfast and dinner. Do not stop suddenly.', prescriber: 'Dr. Vikram Shetty' },
      { medicationName: 'Ramipril', strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -95, endDate: 270, instructions: 'Continue. Blood pressure and kidney function are checked at each visit.', prescriber: 'Dr. Vikram Shetty' },
    ],
    reconciliation: {
      prescribed: ['Aspirin 75 mg', 'Clopidogrel 75 mg', 'Atorvastatin 40 mg', 'Metoprolol 50 mg', 'Ramipril 5 mg'],
      dispensed: ['Aspirin 75 mg', 'Atorvastatin 40 mg', 'Metoprolol 50 mg', 'Ramipril 5 mg', 'Ibuprofen 400 mg'],
      notes: 'Clopidogrel 75 mg was not dispensed because the pharmacist asked for a fresh prescription copy for a schedule medicine. Ibuprofen 400 mg was self-purchased for knee pain.',
    },
    indications: [
      { title: 'Clopidogrel was not dispensed — confirm the copy and start it', detail: 'This record shows dual antiplatelet therapy after a 2019 myocardial infarction and clopidogrel 75 mg was missing from the dispensed list. Please obtain the prescription copy and start the medicine without delay.', severity: 'high' },
      { title: 'Self-purchased ibuprofen with kidney disease', detail: 'Ibuprofen 400 mg was added without a prescription. With chronic kidney disease stage 2 and antiplatelet therapy this needs a prescriber or pharmacist review before it continues.', severity: 'review' },
    ],
  },
  {
    key: 'priya',
    id: 'demo-patient-priya-menon',
    patientId: 'pid-9d44b8e2',
    email: 'priya.menon@example.com',
    fullName: 'Priya Menon',
    dateOfBirth: '1991-06-11',
    allergies: 'No known allergies',
    conditions: 'Pregnancy (28 weeks), Iron deficiency anaemia',
    doctorKey: 'rao',
    medicines: [
      { name: 'Ferrous Sulphate', strength: '200 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily with food', notes: 'Constipation is common' },
      { name: 'Folic Acid', strength: '5 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily after lunch', notes: 'Continue through pregnancy' },
      { name: 'Vitamin D3', strength: '60,000 IU', dose: '1 sachet', route: 'Oral', timing: 'Once weekly after food', notes: 'Same day each week' },
      { name: 'Pantoprazole', strength: '40 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily before breakfast', notes: 'For reflux' },
    ],
    prescriptions: [
      { medicationName: 'Ferrous Sulphate', strength: '200 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily with food', startDate: -60, endDate: 305, instructions: 'Take with food. Report if nausea prevents a dose.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Folic Acid', strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily after lunch', startDate: -140, endDate: 225, instructions: 'Continue daily through pregnancy and the first three months after delivery.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Vitamin D3', strength: '60,000 IU', dose: '1 sachet', route: 'Oral', frequency: 'Once weekly after food', startDate: -28, endDate: 337, instructions: 'One sachet on the same day each week after a meal.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Pantoprazole', strength: '40 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily before breakfast', startDate: -20, endDate: 345, instructions: 'For reflux. Review at the next antenatal visit.', prescriber: 'Dr. Ananya Rao' },
    ],
    reconciliation: {
      prescribed: ['Ferrous Sulphate 200 mg', 'Folic Acid 5 mg', 'Vitamin D3 60,000 IU', 'Pantoprazole 40 mg'],
      dispensed: ['Ferrous Sulphate 200 mg', 'Folic Acid 5 mg', 'Vitamin D3 60,000 IU', 'Pantoprazole 40 mg'],
      notes: 'All four medicines were dispensed exactly as prescribed. Keep the weekly vitamin D sachet on the same day each week.',
    },
    indications: [
      { title: 'Iron tablet causes nausea — take it after dinner', detail: 'If the iron tablet upsets your stomach, take it after the evening meal instead of with breakfast. Do not stop the iron without advice.', severity: 'info' },
      { title: 'Check blood pressure and weight at every antenatal visit', detail: 'Record your weight and blood pressure before each visit and bring the readings to the next review.', severity: 'review' },
    ],
  },
  {
    key: 'lakshmi',
    id: 'demo-patient-lakshmi-devi',
    patientId: 'pid-4c82f0a6',
    email: 'lakshmi.devi@example.com',
    fullName: 'Lakshmi Devi',
    dateOfBirth: '1958-01-30',
    allergies: 'Penicillin — anaphylaxis (admitted to hospital in 2016)',
    conditions: 'COPD (moderate, GOLD 2), Hypertension',
    doctorKey: 'rao',
    medicines: [
      { name: 'Tiotropium', strength: '18 mcg', dose: '1 puff', route: 'Inhalation', timing: 'Once daily in the morning', notes: 'Rinse mouth after use' },
      { name: 'Salbutamol', strength: '100 mcg', dose: '2 puffs', route: 'Inhalation', timing: 'As needed for breathlessness', notes: 'Use a spacer' },
      { name: 'Prednisolone', strength: '5 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Current tapering dose' },
      { name: 'Amoxicillin', strength: '500 mg', dose: '1 capsule', route: 'Oral', timing: 'Twice daily for 5 days', notes: 'Course for a recent chest infection' },
    ],
    prescriptions: [
      { medicationName: 'Tiotropium', strength: '18 mcg', dose: '1 puff', route: 'Inhalation', frequency: 'Once daily in the morning', startDate: -180, endDate: 185, instructions: 'Rinse and spit after each dose.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Salbutamol', strength: '100 mcg', dose: '2 puffs', route: 'Inhalation', frequency: 'As needed for breathlessness', startDate: -180, endDate: 185, instructions: 'Use with a spacer. Seek help if you need more than the usual amount.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Prednisolone', strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -30, endDate: 335, instructions: 'Continue the current tapering dose and review at the next review.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Amoxicillin', strength: '500 mg', dose: '1 capsule', route: 'Oral', frequency: 'Twice daily for 5 days', startDate: -4, endDate: 0, instructions: 'Five-day course for a chest infection. Confirm suitability against the recorded allergy before the next dose.', prescriber: 'Dr. Ananya Rao' },
    ],
    reconciliation: {
      prescribed: ['Tiotropium 18 mcg', 'Salbutamol 100 mcg', 'Prednisolone 5 mg', 'Amoxicillin 500 mg'],
      dispensed: ['Tiotropium 18 mcg', 'Salbutamol 100 mcg', 'Prednisolone 5 mg', 'Amoxicillin 500 mg'],
      notes: 'Every medicine on the prescription was dispensed, including the antibiotic course. The name comparison alone does not confirm whether the antibiotic is safe for you — the allergy on your record needs a clinician check.',
    },
    indications: [
      { title: 'Recorded penicillin allergy and a penicillin-class antibiotic', detail: 'Your record lists a penicillin allergy with anaphylaxis, and amoxicillin 500 mg was dispensed for a chest infection. Amoxicillin is a penicillin-class antibiotic. Please speak to the prescriber or pharmacist before the next dose.', severity: 'high' },
      { title: 'Bring both inhalers to the next review', detail: 'Bring the tiotropium and salbutamol inhalers and the spacer so inhaler technique can be checked at the next visit.', severity: 'review' },
    ],
  },
  {
    key: 'fatima',
    id: 'demo-patient-fatima-khan',
    patientId: 'pid-6e15b7d3',
    email: 'fatima.khan@example.com',
    fullName: 'Fatima Khan',
    dateOfBirth: '1977-01-08',
    allergies: 'Sulfonamides — rash; Penicillin — rash',
    conditions: 'Rheumatoid arthritis (seropositive, since 2018), Anaemia of chronic disease',
    doctorKey: 'iyer',
    medicines: [
      { name: 'Methotrexate', strength: '10 mg', dose: '1 tablet', route: 'Oral', timing: 'Once weekly on Monday', notes: 'Weekly only — not every day' },
      { name: 'Folic Acid', strength: '5 mg', dose: '1 tablet', route: 'Oral', timing: 'Once weekly, the day after methotrexate', notes: 'Reduces nausea' },
      { name: 'Hydroxychloroquine', strength: '200 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily with food', notes: 'Eye checks every year', timing: 'Once daily with food' },
      { name: 'Prednisolone', strength: '5 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Low maintenance dose' },
      { name: 'Naproxen', strength: '500 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily with food for joint pain', notes: 'Bought over the counter' },
    ],
    prescriptions: [
      { medicationName: 'Methotrexate', strength: '10 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once weekly on the same day each week', startDate: -140, endDate: 225, instructions: 'One tablet in the week only. Folic acid is taken the day after.', prescriber: 'Dr. Meera Iyer' },
      { medicationName: 'Folic Acid', strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once weekly, the day after methotrexate', startDate: -140, endDate: 225, instructions: 'Take the day after the methotrexate tablet.', prescriber: 'Dr. Meera Iyer' },
      { medicationName: 'Hydroxychloroquine', strength: '200 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily with food', startDate: -140, endDate: 225, instructions: 'Continue. Book the yearly eye check.', prescriber: 'Dr. Meera Iyer' },
      { medicationName: 'Prednisolone', strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -60, endDate: 305, instructions: 'Continue the low maintenance dose.', prescriber: 'Dr. Meera Iyer' },
    ],
    reconciliation: {
      prescribed: ['Methotrexate 10 mg', 'Folic Acid 5 mg', 'Hydroxychloroquine 200 mg', 'Prednisolone 5 mg'],
      dispensed: ['Methotrexate 10 mg', 'Folic Acid 5 mg', 'Hydroxychloroquine 200 mg', 'Prednisolone 5 mg', 'Naproxen 500 mg'],
      notes: 'Naproxen 500 mg was added from the counter for joint pain. The methotrexate label on the pack reads “once daily” — methotrexate is taken once a week, so please confirm the schedule with the pharmacist.',
    },
    indications: [
      { title: 'Methotrexate is once weekly, not daily', detail: 'The dispensed pack label reads “once daily”. Methotrexate 10 mg is taken once a week on the same day, and folic acid the day after. Please confirm the schedule with the pharmacist before the next dose.', severity: 'review' },
      { title: 'Naproxen alongside methotrexate needs a review', detail: 'Naproxen 500 mg was added without a prescription. Taken alongside methotrexate it needs a stomach-protection and monitoring review at the next appointment.', severity: 'review' },
    ],
  },
  {
    key: 'ravi',
    id: 'demo-patient-ravi-shankar',
    patientId: 'pid-1a90b4e5',
    email: 'ravi.shankar@example.com',
    fullName: 'Ravi Shankar',
    dateOfBirth: '1986-02-19',
    allergies: 'No known allergies',
    conditions: 'Gastro-oesophageal reflux disease, Dyslipidaemia',
    doctorKey: 'rao',
    medicines: [
      { name: 'Omeprazole', strength: '20 mg', dose: '1 capsule', route: 'Oral', timing: 'Once daily, 30 minutes before breakfast', notes: 'Current acid medicine' },
      { name: 'Domperidone', strength: '10 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily before meals', notes: 'For fullness and bloating' },
      { name: 'Atorvastatin', strength: '10 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily at bedtime', notes: 'Repeat lipid profile in 3 months' },
      { name: 'Pantoprazole', strength: '40 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily before breakfast', notes: 'Left over from the earlier prescription' },
    ],
    prescriptions: [
      { medicationName: 'Omeprazole', strength: '20 mg', dose: '1 capsule', route: 'Oral', frequency: 'Once daily, 30 minutes before breakfast', startDate: -50, endDate: 315, instructions: 'Continue for three months, then review whether it is still needed.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Domperidone', strength: '10 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily before meals', startDate: -50, endDate: 315, instructions: 'Take before breakfast and before dinner. Report any heart palpitations.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Atorvastatin', strength: '10 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily at bedtime', startDate: -50, endDate: 315, instructions: 'Continue. Repeat the lipid profile before the next review.', prescriber: 'Dr. Ananya Rao' },
    ],
    reconciliation: {
      prescribed: ['Omeprazole 20 mg', 'Domperidone 10 mg', 'Atorvastatin 10 mg'],
      dispensed: ['Omeprazole 20 mg', 'Domperidone 10 mg', 'Atorvastatin 10 mg', 'Pantoprazole 40 mg'],
      notes: 'Pantoprazole 40 mg is left over from the previous prescription and is still being taken. Two proton-pump inhibitors at the same time should be reviewed.',
    },
    indications: [
      { title: 'Two acid medicines on the list', detail: 'Omeprazole and pantoprazole are both recorded. Continue omeprazole and stop pantoprazole once the current strip is finished, unless the prescriber says otherwise.', severity: 'review' },
    ],
  },
  {
    key: 'anjali',
    id: 'demo-patient-anjali-sharma',
    patientId: 'pid-5d37e9a1',
    email: 'anjali.sharma@example.com',
    fullName: 'Anjali Sharma',
    dateOfBirth: '1995-05-27',
    allergies: 'Ibuprofen — stomach irritation and heartburn',
    conditions: 'Generalised anxiety disorder, Migraine without aura, Insomnia',
    doctorKey: 'rao',
    medicines: [
      { name: 'Sertraline', strength: '50 mg', dose: '1 tablet', route: 'Oral', timing: 'Once daily in the morning', notes: 'Continue the current dose' },
      { name: 'Lorazepam', strength: '10 mg', dose: '1 tablet', route: 'Oral', timing: 'As needed for acute anxiety', notes: 'Maximum one tablet in a week' },
      { name: 'Ibuprofen', strength: '400 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily with food for migraine', notes: 'Also recorded as an allergy' },
      { name: 'Paracetamol', strength: '500 mg', dose: '1 tablet', route: 'Oral', timing: 'Up to three times daily for migraine', notes: 'Bought over the counter' },
      { name: 'Melatonin', strength: '3 mg', dose: '1 tablet', route: 'Oral', timing: 'At bedtime for sleep', notes: 'Bought over the counter' },
    ],
    prescriptions: [
      { medicationName: 'Sertraline', strength: '50 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily in the morning', startDate: -75, endDate: 290, instructions: 'Continue the current dose. Do not stop suddenly.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Lorazepam', strength: '10 mg', dose: '1 tablet', route: 'Oral', frequency: 'As needed for acute anxiety', startDate: -75, endDate: 290, instructions: 'Maximum one tablet in a week. Do not drive after taking it.', prescriber: 'Dr. Ananya Rao' },
      { medicationName: 'Ibuprofen', strength: '400 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily with food for migraine', startDate: -75, endDate: 290, instructions: 'For migraine attacks only. Review with the prescriber because ibuprofen is also recorded as an allergy.', prescriber: 'Dr. Ananya Rao' },
    ],
    reconciliation: {
      prescribed: ['Sertraline 50 mg', 'Lorazepam 10 mg', 'Ibuprofen 400 mg'],
      dispensed: ['Sertraline 50 mg', 'Lorazepam 10 mg', 'Ibuprofen 400 mg', 'Paracetamol 500 mg', 'Melatonin 3 mg'],
      notes: 'Paracetamol 500 mg and a 3 mg melatonin sleep aid were added at the pharmacy counter. Ibuprofen is recorded as causing stomach irritation, so please confirm the best pain relief for migraine with the prescriber.',
    },
    indications: [
      { title: 'Ibuprofen is both prescribed and recorded as an allergy', detail: 'Your record lists ibuprofen 400 mg as a prescribed pain relief and also as an allergy that causes stomach irritation. Please confirm which is correct before the next dose.', severity: 'high' },
      { title: 'Review the sleep aid with sertraline', detail: 'Melatonin 3 mg is not part of this plan. Bring it to the next review so it can be reviewed alongside sertraline.', severity: 'info' },
    ],
  },
];

const ACCESS_REQUESTS = [
  { key: 'ramesh', doctorKey: 'rao', status: 'approved', requestedDaysAgo: 30, respondedDaysAgo: 29 },
  { key: 'joseph', doctorKey: 'shetty', status: 'approved', requestedDaysAgo: 21, respondedDaysAgo: 20 },
  { key: 'sunita', doctorKey: 'iyer', status: 'approved', requestedDaysAgo: 45, respondedDaysAgo: 44 },
  { key: 'fatima', doctorKey: 'iyer', status: 'approved', requestedDaysAgo: 60, respondedDaysAgo: 59 },
  { key: 'priya', doctorKey: 'rao', status: 'revoked', requestedDaysAgo: 40, respondedDaysAgo: 39, revokedDaysAgo: 20 },
  { key: 'lakshmi', doctorKey: 'rao', status: 'pending', requestedDaysAgo: 2 },
  { key: 'anjali', doctorKey: 'rao', status: 'pending', requestedDaysAgo: 1 },
];

const PATIENT_NOTIFICATIONS = [
  { key: 'ramesh', actorKey: 'rao', type: 'access-request', title: 'Access request', message: 'Dr. Ananya Rao requested access to your records.', entityType: 'access_request', daysAgo: 30, read: true },
  { key: 'ramesh', actorKey: 'rao', type: 'patient-record', title: 'Prescription record added', message: 'A prescription record was added to your workspace.', entityType: 'prescription', daysAgo: 12, read: true },
  { key: 'joseph', actorKey: 'shetty', type: 'access-request', title: 'Access request', message: 'Dr. Vikram Shetty requested access to your records.', entityType: 'access_request', daysAgo: 21, read: true },
  { key: 'sunita', actorKey: 'iyer', type: 'access-request', title: 'Access request', message: 'Dr. Meera Iyer requested access to your records.', entityType: 'access_request', daysAgo: 45, read: true },
  { key: 'fatima', actorKey: 'iyer', type: 'access-request', title: 'Access request', message: 'Dr. Meera Iyer requested access to your records.', entityType: 'access_request', daysAgo: 60, read: true },
  { key: 'priya', actorKey: 'rao', type: 'access-request', title: 'Access request', message: 'Dr. Ananya Rao requested access to your records.', entityType: 'access_request', daysAgo: 40, read: true },
  { key: 'priya', actorKey: 'rao', type: 'access-revoked', title: 'Access ended', message: 'Access to your records was ended. You can authorise a clinician again at any time.', entityType: 'access_request', daysAgo: 20, read: true },
  { key: 'lakshmi', actorKey: 'rao', type: 'access-request', title: 'Access request', message: 'Dr. Ananya Rao requested access to your records.', entityType: 'access_request', daysAgo: 2, read: false },
  { key: 'lakshmi', actorKey: 'rao', type: 'doctor-indication', title: 'New clinician indication', message: 'Dr. Ananya Rao added an indication to your record.', entityType: 'indication', daysAgo: 1, read: true },
  { key: 'anjali', actorKey: 'rao', type: 'access-request', title: 'Access request', message: 'Dr. Ananya Rao requested access to your records.', entityType: 'access_request', daysAgo: 1, read: false },
];

const DOCTOR_NOTIFICATIONS = [
  { key: 'rao', actorKey: 'ramesh', type: 'patient-record', title: 'Patient record updated', message: 'Ramesh Kumar updated a medicine list.', entityType: 'medicines', daysAgo: 3, read: true },
  { key: 'rao', actorKey: 'priya', type: 'access-request', title: 'Access request sent', message: 'Your access request for a patient record is awaiting a decision.', entityType: 'access_request', daysAgo: 2, read: true },
  { key: 'rao', actorKey: 'lakshmi', type: 'access-request', title: 'Access request sent', message: 'Your access request for a patient record is awaiting a decision.', entityType: 'access_request', daysAgo: 2, read: false },
  { key: 'shetty', actorKey: 'joseph', type: 'patient-record', title: 'Patient record updated', message: 'Joseph Thomas updated a medicine list.', entityType: 'medicines', daysAgo: 2, read: false },
  { key: 'iyer', actorKey: 'sunita', type: 'patient-record', title: 'Patient record updated', message: 'Sunita Devi updated a medicine list.', entityType: 'medicines', daysAgo: 4, read: true },
  { key: 'iyer', actorKey: 'fatima', type: 'patient-record', title: 'Patient record updated', message: 'Fatima Khan updated a medicine list.', entityType: 'medicines', daysAgo: 1, read: false },
];

const AUDIT_EVENTS = [
  { key: 'ramesh', actorKey: 'rao', action: 'access.approve', entityType: 'access_request', outcome: 'success', daysAgo: 29 },
  { key: 'ramesh', actorKey: 'ramesh', action: 'record.reconciliation_create', entityType: 'reconciliation', outcome: 'success', daysAgo: 12 },
  { key: 'joseph', actorKey: 'shetty', action: 'access.approve', entityType: 'access_request', outcome: 'success', daysAgo: 20 },
  { key: 'joseph', actorKey: 'joseph', action: 'record.reconciliation_create', entityType: 'reconciliation', outcome: 'success', daysAgo: 4 },
  { key: 'lakshmi', actorKey: 'rao', action: 'record.indication_create', entityType: 'indication', outcome: 'success', daysAgo: 1 },
  { key: 'lakshmi', actorKey: 'rao', action: 'access.request', entityType: 'access_request', outcome: 'success', daysAgo: 2 },
  { key: 'anjali', actorKey: 'rao', action: 'access.request', entityType: 'access_request', outcome: 'success', daysAgo: 1 },
  { key: 'fatima', actorKey: 'iyer', action: 'record.indication_create', entityType: 'indication', outcome: 'success', daysAgo: 6 },
];

function doctorRecord(doctor, now) {
  const created = timeAgo(400, now);
  return {
    id: doctor.id,
    email: doctor.email,
    role: 'doctor',
    doctorProfile: {
      displayName: doctor.displayName,
      specialty: doctor.specialty,
      registrationId: doctor.registrationId,
      organization: doctor.organization,
      verificationStatus: doctor.verificationStatus,
      verified: doctor.verificationStatus === 'verified',
      ...(doctor.verificationStatus === 'verified' ? { verifiedAt: timeAgo(380, now) } : {}),
      updatedAt: timeAgo(200, now),
    },
    emailConfirmedAt: created,
    createdAt: created,
    updatedAt: timeAgo(200, now),
  };
}

function patientRecord(patient, now) {
  const created = timeAgo(300, now);
  return {
    id: patient.id,
    email: patient.email,
    role: 'patient',
    patientId: patient.patientId,
    emailConfirmedAt: created,
    createdAt: created,
    updatedAt: timeAgo(1, now),
  };
}

/**
 * Build the full demo state in the same shape the backend persists.
 * Timestamps are relative to `now` so a freshly seeded workspace always looks
 * current instead of showing a fixed date from whenever the script was written.
 */
export function buildDemoState(now = Date.now()) {
  const users = [];
  const profiles = [];
  const medicines = [];
  const prescriptions = [];
  const reconciliations = [];
  const medicalRecords = [];
  const indications = [];
  const accessRequests = [];
  const notifications = [];
  const auditLogs = [];

  const doctorByKey = new Map(DOCTORS.map((doctor) => [doctor.key, doctor]));
  const patientByKey = new Map(PATIENTS.map((patient) => [patient.key, patient]));

  for (const doctor of DOCTORS) {
    users.push(doctorRecord(doctor, now));
    profiles.push({
      userId: doctor.id,
      fullName: doctor.displayName,
      dateOfBirth: '',
      allergies: '',
      conditions: '',
      updatedAt: timeAgo(200, now),
    });
  }

  for (const patient of PATIENTS) {
    const user = patientRecord(patient, now);
    users.push(user);
    profiles.push({
      userId: patient.id,
      fullName: patient.fullName,
      dateOfBirth: patient.dateOfBirth,
      allergies: patient.allergies,
      conditions: patient.conditions,
      updatedAt: timeAgo(1, now),
    });

    medicines.push({
      userId: patient.id,
      items: patient.medicines.map((medicine, index) => ({
        id: `${patient.id}-medicine-${index + 1}`,
        name: medicine.name,
        strength: medicine.strength || '',
        dose: medicine.dose || '',
        route: medicine.route || '',
        timing: medicine.timing || '',
        notes: medicine.notes || '',
        status: 'active',
        startedAt: dateOnly(-120 + index * 10, now),
        stoppedAt: '',
        reason: '',
        prescriber: patient.doctorKey ? `Dr. ${DOCTORS.find((d) => d.key === patient.doctorKey)?.displayName?.replace('Dr. ', '') || ''}` : '',
        createdAt: timeAgo(120 - index, now),
        updatedAt: timeAgo(10 - index, now),
      })),
      updatedAt: timeAgo(2, now),
    });

    for (const [index, prescription] of patient.prescriptions.entries()) {
      prescriptions.push({
        id: `${patient.id}-prescription-${index + 1}`,
        userId: patient.id,
        medicationName: prescription.medicationName,
        strength: prescription.strength || '',
        dose: prescription.dose || '',
        route: prescription.route || '',
        frequency: prescription.frequency || '',
        startDate: dateOnly(prescription.startDate, now),
        endDate: dateOnly(prescription.endDate, now),
        instructions: prescription.instructions || '',
        prescriber: prescription.prescriber || '',
        createdAt: timeAgo(Math.max(120 - index * 20, 2), now),
        updatedAt: timeAgo(Math.max(120 - index * 20, 2), now),
      });
    }

    // Medical records (lab reports, imaging, clinical notes, etc.)
    if (patient.medicalRecords) {
      for (const [index, record] of patient.medicalRecords.entries()) {
        medicalRecords.push({
          id: `${patient.id}-record-${index + 1}`,
          userId: patient.id,
          type: record.type,
          title: record.title,
          date: dateOnly(record.daysAgo * -1, now),
          description: record.description || '',
          fileRef: '',
          mimeType: record.mimeType || '',
          sizeBytes: 0,
          tags: record.tags || [],
          source: record.source || 'clinic',
          createdAt: timeAgo(record.daysAgo, now),
          updatedAt: timeAgo(record.daysAgo, now),
          data: record.data || {},
        });
      }
    }


    const comparison = compareMedicines(patient.reconciliation.prescribed.join('\n'), patient.reconciliation.dispensed.join('\n'));
    reconciliations.push({
      id: `${patient.id}-reconciliation-1`,
      userId: patient.id,
      prescriptionMedicines: patient.reconciliation.prescribed,
      dispensedMedicines: patient.reconciliation.dispensed,
      matched: comparison.matched,
      missing: comparison.missing,
      unexpected: comparison.unexpected,
      isExactMatch: comparison.isExactMatch,
      notes: patient.reconciliation.notes,
      createdAt: timeAgo(3, now),
    });

    const doctor = doctorByKey.get(patient.doctorKey);
    for (const [index, indication] of patient.indications.entries()) {
      indications.push({
        id: `${patient.id}-indication-${index + 1}`,
        doctorUserId: doctor.id,
        patientUserId: patient.id,
        title: indication.title,
        detail: indication.detail,
        severity: indication.severity,
        createdAt: timeAgo(6 - index, now),
        updatedAt: timeAgo(6 - index, now),
      });
    }
  }

  for (const [index, request] of ACCESS_REQUESTS.entries()) {
    const doctor = doctorByKey.get(request.doctorKey);
    const patient = patientByKey.get(request.key);
    accessRequests.push({
      id: `demo-access-request-${index + 1}`,
      doctorUserId: doctor.id,
      patientUserId: patient.id,
      status: request.status,
      requestedAt: timeAgo(request.requestedDaysAgo, now),
      ...(request.respondedDaysAgo === undefined ? {} : { respondedAt: timeAgo(request.respondedDaysAgo, now) }),
      ...(request.revokedDaysAgo === undefined ? {} : { revokedAt: timeAgo(request.revokedDaysAgo, now) }),
    });
  }

  for (const [index, notification] of PATIENT_NOTIFICATIONS.entries()) {
    const doctor = doctorByKey.get(notification.actorKey);
    notifications.push({
      id: `demo-notification-patient-${index + 1}`,
      recipientUserId: patientByKey.get(notification.key).id,
      actorUserId: doctor.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityId: null,
      readAt: notification.read ? timeAgo(notification.daysAgo, now) : null,
      createdAt: timeAgo(notification.daysAgo, now),
    });
  }

  for (const [index, notification] of DOCTOR_NOTIFICATIONS.entries()) {
    const patient = patientByKey.get(notification.actorKey);
    notifications.push({
      id: `demo-notification-doctor-${index + 1}`,
      recipientUserId: doctorByKey.get(notification.key).id,
      actorUserId: patient.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityId: null,
      readAt: notification.read ? timeAgo(notification.daysAgo, now) : null,
      createdAt: timeAgo(notification.daysAgo, now),
    });
  }

  for (const [index, event] of AUDIT_EVENTS.entries()) {
    const actor = doctorByKey.has(event.actorKey) ? doctorByKey.get(event.actorKey) : patientByKey.get(event.actorKey);
    auditLogs.push({
      id: `demo-audit-log-${index + 1}`,
      actorUserId: actor.id,
      action: event.action,
      entityType: event.entityType,
      entityId: null,
      outcome: event.outcome,
      createdAt: timeAgo(event.daysAgo, now),
    });
  }

  return {
    version: 2,
    users,
    sessions: [],
    oauthStates: [],
    profiles,
    medicines,
    prescriptions,
    medicalRecords,
    reconciliations,
    indications,
    notifications,
    accessRequests,
    auditLogs,
  };
}

export const demoAccounts = [
  ...DOCTORS.map((doctor) => ({
    role: 'doctor',
    name: doctor.displayName,
    specialty: doctor.specialty,
    email: doctor.email,
    verificationStatus: doctor.verificationStatus,
    id: doctor.id,
  })),
  ...PATIENTS.map((patient) => ({
    role: 'patient',
    name: patient.fullName,
    condition: patient.conditions.split(',')[0],
    email: patient.email,
    id: patient.id,
    patientId: patient.patientId,
  })),
];

export const demoPassword = DEMO_PASSWORD;
