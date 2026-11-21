// Wipes the demo database and fills it with the sample data (src/demo/seedData.js).
// It refuses to run anywhere but a database whose name contains "demo", with DEMO_MODE=true, so it can never
// touch the real data.
const mongoose = require('mongoose');
const { build } = require('./seedData');

function assertDemoDatabase(dbName, env = process.env) {
  if (env.DEMO_MODE !== 'true') throw new Error('Refusing to reset: DEMO_MODE is not true.');
  if (!/demo/i.test(String(dbName || ''))) throw new Error(`Refusing to reset: database "${dbName}" does not look like the demo database.`);
}

async function wipe(db) {
  const cols = await db.listCollections().toArray();
  for (const c of cols) if (!c.name.startsWith('system.')) await db.collection(c.name).deleteMany({});
}

async function run(now = Date.now()) {
  const db = mongoose.connection.db;
  assertDemoDatabase(mongoose.connection.name);
  const Candidate = require('../models/Candidate');
  const Recruiter = require('../models/Recruiter');
  const SkillAssessment = require('../models/SkillAssessment');
  const SkillResult = require('../models/SkillResult');
  const JobPosting = require('../models/JobPosting');
  const JobApplication = require('../models/JobApplication');
  const ConnectionRequest = require('../models/ConnectionRequest');
  const skills = require('../services/skills');

  await wipe(db);
  const data = build(now);
  await SkillAssessment.insertMany(data.skillAssessments);

  const recruiters = {};
  for (const x of data.recruiters) { const { key, ...doc } = x; recruiters[key] = await Recruiter.create(doc); }

  const candidates = [];
  for (const c of data.candidates) {
    const cand = await Candidate.create(c.doc);
    for (const res of c.results) await SkillResult.create({ ...res, candidateId: cand._id });
    await skills.refreshSkillSummary(cand);
    candidates.push(cand);
  }

  const postings = [];
  for (const p of data.postings) { const { recruiterKey, ...doc } = p; postings.push(await JobPosting.create({ ...doc, recruiterId: recruiters[recruiterKey]._id })); }

  const FinalistTest = require('../models/FinalistTest');
  const seen = {};
  for (const a of data.applications) {
    const posting = postings[a.postingIx];
    const k = seen[a.postingIx] = (seen[a.postingIx] === undefined ? 0 : seen[a.postingIx] + 1);
    const doc = { jobId: posting._id, candidateId: candidates[a.candidateIx]._id, recruiterId: posting.recruiterId, status: a.status, appliedAt: a.appliedAt, stageChangedAt: a.appliedAt };
    // Sample job test scores on the first recruiter's postings, so the applicants table has something to sort by.
    const score = data.jobTestScores[a.postingIx] && data.jobTestScores[a.postingIx][k];
    if (score !== undefined) Object.assign(doc, { roleTestStatus: 'done', roleTestResult: { score, takenAt: new Date(a.appliedAt.getTime() + 3600000), freeForm: [] } });
    const app = await JobApplication.create(doc);
    // Finalist tests on the first posting: one scored, one waiting, one that ran out of time (the recruiter decides).
    const fin = data.finalists[a.postingIx] && data.finalists[a.postingIx][k];
    if (fin) {
      const sentAt = new Date(now - fin.hoursAgo * 3600000);
      await FinalistTest.create({
        jobId: posting._id, applicationId: app._id, recruiterId: posting.recruiterId, candidateId: app.candidateId, assessmentId: 'demo-finalist',
        topics: posting.finalistTopics, status: fin.status, sentAt, expiresAt: new Date(sentAt.getTime() + 72 * 3600000),
        respondedAt: fin.status === 'sent' ? null : sentAt, completedAt: fin.status === 'completed' ? new Date(sentAt.getTime() + 7200000) : null,
        score: fin.score === undefined ? null : fin.score, topicScores: fin.topicScores || [], recruiterNotified: true,
      });
    }
  }

  for (const c of data.connections) {
    const when = new Date(now - 6 * 86400000);
    await ConnectionRequest.create({
      candidateId: candidates[c.candidateIx]._id, recruiterId: recruiters.jordan._id, note: c.note, status: c.status, initiatedBy: 'recruiter',
      createdAt: when, respondedAt: c.status === 'accepted' ? when : null,
      fullAccessStatus: c.full ? 'granted' : 'none', fullAccessRequestedAt: c.full ? when : null, fullAccessRespondedAt: c.full ? when : null,
      contactShared: c.status === 'accepted' ? { candidate: { email: true, phone: true, sharedAt: when } } : undefined,
    });
  }

  return { recruiters: data.recruiters.length, candidates: candidates.length, postings: postings.length, applications: data.applications.length, connections: data.connections.length };
}

module.exports = { run, assertDemoDatabase, wipe };
