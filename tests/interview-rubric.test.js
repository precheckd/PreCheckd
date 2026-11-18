// Run: node tests/interview-rubric.test.js
// The example interview rubric is shown to recruiters only, covers all five questions, and carries the disclaimer.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { INTERVIEW_QUESTIONS } = require('../src/utils/interviewQuestions');
const rubric = require('../src/content/interviewRubric');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

t('every interview question has a rubric with five anchors and listening cues', () => {
  for (const q of INTERVIEW_QUESTIONS) {
    const r = rubric.RUBRIC[q.questionId];
    assert.ok(r, 'no rubric for question ' + q.questionId);
    assert.deepStrictEqual(r.anchors.map((a) => a.score), ['5', '4', '3', '2', '0-1']);
    assert.ok(r.listenFor.length >= 3 && r.competency);
  }
  assert.ok(rubric.PROBES.length >= 4);
});

t('the disclaimer says example, not validated, own decisions, and that PreCheckd does not score', () => {
  for (const s of ['example rubric', 'not a validated assessment', 'make your own decisions', 'PreCheckd does not score']) assert.ok(rubric.DISCLAIMER.includes(s), s);
});

t('only the recruiter side sees the rubric: no candidate or public view or route mentions it', () => {
  const holders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, f.name);
      if (f.isDirectory()) walk(rel);
      else if (/interviewRubric/.test(read(rel))) holders.push(rel);
    }
  };
  walk('views'); walk('src/routes'); walk('public');
  assert.deepStrictEqual(holders.sort(), ['src/routes/recruiter-dashboard.js', 'views/recruiter-candidate-profile.ejs']);
});

t('the recruiter profile shows the disclaimer once and a rubric under each recorded answer, and nothing for unanswered ones', () => {
  const view = read('views/recruiter-candidate-profile.ejs');
  const start = view.indexOf('<% const answered');
  const end = view.indexOf('<% if (resumeUrl) { %>', start);
  assert.ok(start > 0 && end > start);
  const snippet = view.slice(start, end);
  const videos = [1, 3].map((id) => ({ questionId: id, question: INTERVIEW_QUESTIONS[id - 1].prompt, videoUrl: 'https://v/' + id }))
    .concat([{ questionId: 2, question: 'x', videoUrl: null }]);
  const html = ejs.render(snippet, { video: { interviewVideos: videos }, interviewRubric: rubric });
  assert.strictEqual((html.match(/Example rubric \(for you only\)/g) || []).length, 1);
  assert.strictEqual((html.match(/<details class="rubric"/g) || []).length, 2);
  assert.ok(html.includes('Adaptability and resilience') && html.includes('Collaboration and influence') && !html.includes('Judgment and problem-solving'));
  const none = ejs.render(snippet, { video: { interviewVideos: [] }, interviewRubric: rubric });
  assert.ok(!none.includes('rubric'));
});

console.log(`\n${n} passed`);
