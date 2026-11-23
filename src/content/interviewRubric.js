// EXAMPLE scoring rubric for the five video interview questions (src/utils/interviewQuestions.js), shown to
// RECRUITERS ONLY, next to each recorded answer. Candidates never see it (so it can't be scripted to), and nothing
// is scored or stored by PreCheckd. It is not a validated assessment and does not predict job performance.
// Keyed by questionId. Anchors run from 5 (highest) to 0-1.
const DISCLAIMER = 'This is an example rubric, not a validated assessment, and it does not predict job performance. '
  + 'Judge only what the candidate says, never their accent, appearance, delivery style, setting or equipment. Use it as a guide if it helps, and make your own decisions about candidates. Apply the same standard to every candidate, '
  + 'and rely on your live interview to confirm what you see here. PreCheckd does not score these answers.';

const RUBRIC = {
  1: {
    competency: 'Adaptability and resilience',
    anchors: [
      { score: '5', text: 'Quickly reframed the situation as an opportunity; sought to understand before acting; took concrete steps; reflects on what they learned; acknowledges initial discomfort but emphasizes growth.' },
      { score: '4', text: 'Adapted effectively; some initial resistance acknowledged; clear action steps; learning evident but not deeply reflected on.' },
      { score: '3', text: 'Eventually adapted but took time; focused on external factors; functional response without proactive problem-solving.' },
      { score: '2', text: 'Adapted reluctantly; blamed circumstances; minimal proactive effort; little evidence of learning.' },
      { score: '0-1', text: 'Resisted change; blamed others; no forward movement or learning described.' },
    ],
    listenFor: ['Speed of reorientation', 'Whether they took agency or waited for direction', 'Evidence of learning, not just compliance'],
  },
  2: {
    competency: 'Judgment and problem-solving',
    anchors: [
      { score: '5', text: 'Clear decision framework (weighed tradeoffs, consulted input); justified reasoning; specific outcome data; thoughtful about what would change and what they would keep; avoids hindsight bias.' },
      { score: '4', text: 'Solid reasoning process; outcome-focused; some reflection on alternatives but the framework could be clearer.' },
      { score: '3', text: 'Made a reasonable decision; describes the process but limited evidence of structured thinking; surface-level reflection.' },
      { score: '2', text: 'Decision made but reasoning unclear; limited consideration of consequences; minimal reflection on alternatives.' },
      { score: '0-1', text: 'Poor decision with weak rationale; blames circumstances; no reflection or accountability.' },
    ],
    listenFor: ['Evidence of a process, not just intuition', 'Intellectual humility (what they would do differently)', 'Specificity about outcomes and data'],
  },
  3: {
    competency: 'Collaboration and influence',
    anchors: [
      { score: '5', text: 'Named specific behaviors (not personality attacks); took a perspective-taking approach; identified common ground; owned their contribution to the friction; relationship improved or a functional outcome was reached.' },
      { score: '4', text: 'Clear description of what made it difficult; some self-awareness; found a workable solution; collaborated despite differences.' },
      { score: '3', text: 'Described the challenge and worked through it; limited reflection on their own role or what they learned.' },
      { score: '2', text: 'Focused mostly on what the other person did wrong; tolerated the relationship without real resolution; minimal collaboration.' },
      { score: '0-1', text: 'Blamed the other person entirely; unresolved conflict; dismissed the other person\'s view; no evidence of trying to understand their perspective.' },
    ],
    listenFor: ['Whether they describe behaviors rather than attacking character', 'Curiosity about the other person\'s perspective', 'Acknowledgment of their own impact'],
  },
  4: {
    competency: 'Self-awareness and learning orientation',
    anchors: [
      { score: '5', text: 'A genuine gap (not a humble-brag); specific (for example "public speaking," not "perfectionism"); an active learning strategy in place; explains why it matters; views it as improvable.' },
      { score: '4', text: 'A real gap; some action on improvement; clear understanding of its impact; growth mindset evident.' },
      { score: '3', text: 'Acknowledges a limitation; improving, but the approach could be more systematic; partial understanding of why it matters.' },
      { score: '2', text: 'Describes a gap but frames it as "not a big deal" or deflects; minimal action on improvement; unclear why they care.' },
      { score: '0-1', text: 'Disguises a strength as a weakness; refuses to acknowledge real gaps; fixed mindset (cannot improve).' },
    ],
    listenFor: ['Is it a real gap or false modesty?', 'How active is their improvement plan?', 'Do they view gaps as improvable?'],
  },
  5: {
    competency: 'Motivation and drive',
    anchors: [
      { score: '5', text: 'Clearly explains why it mattered to them; motivated by mastery, learning or purpose, not just titles or money; describes impact; shows ownership; explains why they care, not just why it was important.' },
      { score: '4', text: 'Genuine accomplishment; a mix of intrinsic and extrinsic motivation; clear impact.' },
      { score: '3', text: 'Solid accomplishment; mostly extrinsic framing (money, recognition), or intrinsic but with limited depth; describes what happened more than why it mattered.' },
      { score: '2', text: 'Accomplishment feels hollow or is described without real engagement; deflects to team credit; unclear what they actually contributed.' },
      { score: '0-1', text: 'Struggles to name anything they are proud of; only external motivators surface.' },
    ],
    listenFor: ['Whether they explain why it mattered to them', 'Whether pride comes from growth, impact or external recognition', 'Ownership versus luck or others\' help'],
  },
};

// Follow-up probes a recruiter can use live if an answer is vague.
const PROBES = ['Can you give me a specific example?', 'What did you actually do, step by step?', 'How do you think they saw it?', 'What would you do differently?', 'What did you learn?'];

module.exports = { RUBRIC, DISCLAIMER, PROBES };
