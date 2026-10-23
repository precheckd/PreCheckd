// The fixed choices on the job posting form. Nothing on the form is free-form except the description text.
const { SHIFT_OPTIONS } = require('../utils/availabilityMatching');
const { LEVELS: EDUCATION_LEVELS } = require('../utils/educationLevel');
const { CLEARANCE_OPTIONS } = require('../utils/clearanceMatching');

const ARRANGEMENTS = [
  { code: 'onsite', label: 'On-site' },
  { code: 'hybrid', label: 'Hybrid' },
  { code: 'remote', label: 'Remote' },
  { code: 'remote_in_area', label: 'Remote in Area' },
];

const EMPLOYMENT_TYPES = [
  { code: 'full_time', label: 'Full-time' },
  { code: 'part_time', label: 'Part-time' },
  { code: 'contract', label: 'Contract' },
  { code: 'temp', label: 'Temp' },
  { code: 'internship', label: 'Internship' },
];

const TRAVEL = [
  { code: 'none', label: 'None' },
  { code: 'occasional', label: 'Occasional' },
  { code: 'up_to_25', label: 'Up to 25%' },
  { code: 'up_to_50', label: 'Up to 50%' },
  { code: 'over_50', label: 'More than 50%' },
];

// What the base pay range is based on (any of these; never years of experience or education).
const PAY_BASIS = [
  { code: 'skill_level', label: 'Verified skill level' },
  { code: 'certifications', label: 'Certifications' },
  { code: 'location', label: 'Location' },
  { code: 'pay_band', label: 'Internal pay band' },
  { code: 'negotiable', label: 'Negotiable' },
];

const BENEFITS = [
  { code: 'health', label: 'Health insurance' },
  { code: 'dental', label: 'Dental' },
  { code: 'vision', label: 'Vision' },
  { code: '401k', label: '401(k)' },
  { code: '401k_match', label: '401(k) match' },
  { code: 'pto', label: 'Paid time off' },
  { code: 'paid_holidays', label: 'Paid holidays' },
  { code: 'paid_sick', label: 'Paid sick leave' },
  { code: 'parental_leave', label: 'Parental leave' },
  { code: 'training_budget', label: 'Tuition or training budget' },
  { code: 'equipment', label: 'Equipment or stipend' },
  { code: 'remote_stipend', label: 'Remote or hybrid stipend' },
  { code: 'life_disability', label: 'Life or disability insurance' },
];

// Minimum levels a recruiter can require. "Developing" is below what a candidate can show, so it is not offered.
const MIN_LEVELS = ['Foundational', 'Intermediate', 'Advanced', 'Expert'];

const LIMITS = {
  maxSkills: 3,
  maxCertGroups: 3,
  maxCertsPerGroup: 5,
  maxCloseDays: 45,       // applications-close date: at most about 45 days out
  maxStartDays: 365,
  payWidth: 1.25,         // base pay max may be at most 25% above min
  summaryMin: 50, summaryMax: 2000,
  respMin: 3, respMax: 15, respLineMin: 5, respLineMax: 300,
  shortLine: 160,
  noteMax: 80,
};

module.exports = {
  ARRANGEMENTS, EMPLOYMENT_TYPES, TRAVEL, PAY_BASIS, BENEFITS, MIN_LEVELS, LIMITS,
  SHIFT_OPTIONS, EDUCATION_LEVELS, CLEARANCE_OPTIONS,
};
