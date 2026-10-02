// The 5 fixed behavioral interview questions used for a candidate's video
// interview. These map to a scoring rubric that isn't wired up yet — for now
// they're just prompts the candidate records answers to; no scoring logic
// here or anywhere downstream.
const INTERVIEW_QUESTIONS = [
  {
    questionId: 1,
    category: 'Adaptability and Resilience',
    prompt: 'Tell me about a time when something significant changed in your work and how you handled it.'
  },
  {
    questionId: 2,
    category: 'Judgment and Problem-Solving',
    prompt: 'Describe a situation where you had to make a decision with incomplete information.'
  },
  {
    questionId: 3,
    category: 'Collaboration and Influence',
    prompt: 'Tell me about a time you needed to work closely with someone you found difficult.'
  },
  {
    questionId: 4,
    category: 'Self-Awareness and Learning Orientation',
    prompt: "What's something you're genuinely not good at or a skill gap you have?"
  },
  {
    questionId: 5,
    category: 'Motivation and Drive',
    prompt: "What's a project or accomplishment you're genuinely proud of?"
  }
];

module.exports = { INTERVIEW_QUESTIONS };
