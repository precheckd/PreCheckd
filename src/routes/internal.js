const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const FraudReport = require('../models/FraudReport');
const Message = require('../models/Message');
const { PUBLIC_EMAIL_DOMAINS, EMAIL_REPORT_THRESHOLD, DOMAIN_REPORT_THRESHOLD } = require('../config/fraudConfig');

const INTERNAL_ADMIN_SECRET = process.env.INTERNAL_ADMIN_SECRET;

function requireInternalAuth(req, res, next) {
  if (req.session.isInternalAdmin) {
    return next();
  }
  res.redirect('/internal/login');
}

// Login page
router.get('/login', (req, res) => {
  res.render('internal-login', { error: null });
});

router.post('/login', (req, res) => {
  const { secret } = req.body;

  if (!INTERNAL_ADMIN_SECRET) {
    return res.render('internal-login', { error: 'INTERNAL_ADMIN_SECRET is not configured on the server.' });
  }

  if (secret === INTERNAL_ADMIN_SECRET) {
    req.session.isInternalAdmin = true;
    return res.redirect('/internal');
  }

  res.render('internal-login', { error: 'Incorrect password.' });
});

router.get('/logout', (req, res) => {
  req.session.isInternalAdmin = false;
  res.redirect('/internal/login');
});

router.use(requireInternalAuth);

// Landing dashboard — links out to each internal tool
router.get('/', async (req, res) => {
  try {
    const [candidateCount, flaggedCount, disputeThreads] = await Promise.all([
      Candidate.countDocuments({
        $or: [
          { 'workHistory.0': { $exists: true } },
          { 'educationHistory.0': { $exists: true } },
          { 'certifications.0': { $exists: true } }
        ]
      }),
      FraudReport.aggregate([
        {
          $group: {
            _id: '$reportedEmail',
            reporters: { $addToSet: '$reporterEmail' }
          }
        },
        { $project: { distinctReporters: { $size: '$reporters' } } },
        { $match: { distinctReporters: { $gte: EMAIL_REPORT_THRESHOLD } } },
        { $count: 'total' }
      ]),
      Message.aggregate([
        { $match: { fraudReportId: { $ne: null } } },
        { $sort: { sentAt: -1 } },
        { $group: { _id: '$fraudReportId', latestSenderType: { $first: '$senderType' } } },
        { $match: { latestSenderType: 'recruiter' } },
        { $count: 'total' }
      ]),
    ]);

    res.render('internal-dashboard', {
      candidateCount,
      flaggedCount: flaggedCount[0]?.total || 0,
      disputeAttentionCount: disputeThreads[0]?.total || 0,
    });
  } catch (error) {
    console.error('Error loading internal dashboard:', error);
    res.status(500).send('Server error');
  }
});

// List all candidates who have at least one work/education/certification entry
router.get('/verify', async (req, res) => {
  try {
    const candidates = await Candidate.find({
      $or: [
        { 'workHistory.0': { $exists: true } },
        { 'educationHistory.0': { $exists: true } },
        { 'certifications.0': { $exists: true } }
      ]
    }).sort({ createdAt: -1 });

    res.render('internal-verify-list', { candidates });
  } catch (error) {
    console.error('Error loading internal verify list:', error);
    res.status(500).send('Server error');
  }
});

// Detail view for one candidate — shows every entry with a toggle
router.get('/verify/:candidateId', async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }
    res.render('internal-verify-detail', { candidate });
  } catch (error) {
    console.error('Error loading candidate for internal verify:', error);
    res.status(500).send('Server error');
  }
});

// Toggle a single entry's verified status
router.post('/verify/:candidateId/toggle', async (req, res) => {
  try {
    const { category, index } = req.body;
    const candidate = await Candidate.findById(req.params.candidateId);

    if (!candidate) {
      return res.status(404).send('Candidate not found.');
    }

    const validCategories = ['workHistory', 'educationHistory', 'certifications'];
    if (!validCategories.includes(category)) {
      return res.status(400).send('Invalid category.');
    }

    const entry = candidate[category][index];
    if (!entry) {
      return res.status(400).send('Entry not found at that index.');
    }

    entry.verified = !entry.verified;
    entry.verifiedAt = entry.verified ? new Date() : null;

    candidate.markModified(category);
    await candidate.save();

    res.redirect(`/internal/verify/${candidate._id}`);
  } catch (error) {
    console.error('Error toggling verification status:', error);
    res.status(500).send('Server error');
  }
});

// Fraud dashboard — lists EVERY reported email/domain, not just ones that
// crossed the threshold. A single, isolated report can be the first sign of
// something that blows up later, so nothing gets hidden from staff; the
// threshold is only used (client-side, via `flagged` below) to highlight
// rows worth looking at first.
router.get('/fraud', async (req, res) => {
  try {
    const flaggedEmails = await FraudReport.aggregate([
      {
        $group: {
          _id: '$reportedEmail',
          reporters: { $addToSet: '$reporterEmail' },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
          matchedRecruiterId: { $first: '$matchedRecruiterId' },
        }
      },
      {
        $project: {
          reportedEmail: '$_id',
          distinctReporters: { $size: '$reporters' },
          count: 1,
          latest: 1,
          matchedRecruiterId: 1,
        }
      },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);
    flaggedEmails.forEach((item) => {
      item.flagged = item.distinctReporters >= EMAIL_REPORT_THRESHOLD;
    });

    const flaggedDomains = await FraudReport.aggregate([
      { $match: { reportedDomain: { $nin: PUBLIC_EMAIL_DOMAINS, $ne: '' } } },
      {
        $group: {
          _id: '$reportedDomain',
          reporters: { $addToSet: '$reporterEmail' },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
        }
      },
      {
        $project: {
          reportedDomain: '$_id',
          distinctReporters: { $size: '$reporters' },
          count: 1,
          latest: 1,
        }
      },
      { $sort: { distinctReporters: -1, latest: -1 } },
    ]);
    flaggedDomains.forEach((item) => {
      item.flagged = item.distinctReporters >= DOMAIN_REPORT_THRESHOLD;
    });

    res.render('internal-fraud-list', {
      flaggedEmails,
      flaggedDomains,
      emailThreshold: EMAIL_REPORT_THRESHOLD,
      domainThreshold: DOMAIN_REPORT_THRESHOLD,
    });
  } catch (error) {
    console.error('Error loading fraud dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Detail view — every individual report against one exact email address
router.get('/fraud/email/:email', async (req, res) => {
  try {
    const reportedEmail = req.params.email.toLowerCase();
    const reports = await FraudReport.find({ reportedEmail })
      .sort({ createdAt: -1 })
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified isSuspended');

    // Only an exact-email match actually points at the account behind
    // *this* reported email — a domain match points at a different person
    // at the same company, so suspending from here would hit the wrong
    // account. Find the first report (if any) that's a real exact match.
    const matchedAccount = reports.find((r) => r.matchType === 'email' && r.matchedRecruiterId)?.matchedRecruiterId || null;

    res.render('internal-fraud-detail', {
      targetLabel: reportedEmail,
      targetType: 'email',
      reports,
      matchedAccount,
    });
  } catch (error) {
    console.error('Error loading fraud detail (email):', error);
    res.status(500).send('Server error');
  }
});

// Detail view — every individual report against one domain
router.get('/fraud/domain/:domain', async (req, res) => {
  try {
    const reportedDomain = req.params.domain.toLowerCase();
    const reports = await FraudReport.find({ reportedDomain })
      .sort({ createdAt: -1 })
      .populate('matchedRecruiterId', 'firstName lastName email slug isIdentityVerified isSuspended');

    res.render('internal-fraud-detail', {
      targetLabel: reportedDomain,
      targetType: 'domain',
      reports,
      matchedAccount: null,
    });
  } catch (error) {
    console.error('Error loading fraud detail (domain):', error);
    res.status(500).send('Server error');
  }
});

// Suspend / unsuspend a recruiter account — manual, staff-only, reversible.
// Never automated and never visible to anyone but the recruiter themselves
// (and only indirectly, as a login/profile dead-end) — nothing here is ever
// surfaced publicly as "this account was suspended for fraud."
router.post('/recruiter/:id/suspend', async (req, res) => {
  try {
    const { redirectTo } = req.body;
    await Recruiter.findByIdAndUpdate(req.params.id, {
      isSuspended: true,
      suspendedAt: new Date(),
    });
    res.redirect(redirectTo || '/internal/fraud');
  } catch (error) {
    console.error('Error suspending recruiter account:', error);
    res.status(500).send('Server error');
  }
});

router.post('/recruiter/:id/unsuspend', async (req, res) => {
  try {
    const { redirectTo } = req.body;
    await Recruiter.findByIdAndUpdate(req.params.id, {
      isSuspended: false,
      suspendedAt: null,
    });
    res.redirect(redirectTo || '/internal/fraud');
  } catch (error) {
    console.error('Error unsuspending recruiter account:', error);
    res.status(500).send('Server error');
  }
});

// Dispute inbox — every fraud-dispute thread (the in-platform conversation
// tied to a report via fraudReportId), meant to be checked like an inbox
// rather than relying on an email ping per reply. "Needs attention" means
// the most recent message in the thread came from the recruiter — i.e.
// it's staff's turn to respond. Same definition the landing-page count uses.
router.get('/disputes', async (req, res) => {
  try {
    const threads = await Message.aggregate([
      { $match: { fraudReportId: { $ne: null } } },
      { $sort: { sentAt: -1 } },
      {
        $group: {
          _id: '$fraudReportId',
          latestBody: { $first: '$body' },
          latestSentAt: { $first: '$sentAt' },
          latestSenderType: { $first: '$senderType' },
        }
      },
      { $sort: { latestSentAt: -1 } },
    ]);

    const reports = await FraudReport.find({ _id: { $in: threads.map((t) => t._id) } })
      .populate('matchedRecruiterId', 'firstName lastName email');

    const reportsById = {};
    reports.forEach((r) => { reportsById[r._id.toString()] = r; });

    const threadsForView = threads.map((t) => {
      const report = reportsById[t._id.toString()];
      const recruiter = report?.matchedRecruiterId;
      return {
        fraudReportId: t._id,
        latestBody: t.latestBody,
        latestSentAt: t.latestSentAt,
        needsAttention: t.latestSenderType === 'recruiter',
        recruiterName: recruiter ? `${recruiter.firstName} ${recruiter.lastName || ''}`.trim() : 'Unknown',
        reportedEmail: report ? report.reportedEmail : 'Unknown',
      };
    });

    res.render('internal-disputes-list', { threads: threadsForView });
  } catch (error) {
    console.error('Error loading disputes list:', error);
    res.status(500).send('Server error');
  }
});

// Dispute thread detail — full back-and-forth, plus a reply box so staff
// can respond without leaving the dashboard. Opening it marks the
// recruiter's messages read, same as a normal inbox.
router.get('/disputes/:fraudReportId', async (req, res) => {
  try {
    const { fraudReportId } = req.params;

    const report = await FraudReport.findById(fraudReportId)
      .populate('matchedRecruiterId', 'firstName lastName email');

    if (!report) {
      return res.status(404).send('Report not found.');
    }

    const messages = await Message.find({ fraudReportId }).sort({ sentAt: 1 });

    await Message.updateMany(
      { fraudReportId, recipientType: 'system', readAt: null },
      { readAt: new Date() }
    );

    res.render('internal-dispute-detail', { report, messages, fraudReportId });
  } catch (error) {
    console.error('Error loading dispute thread:', error);
    res.status(500).send('Server error');
  }
});

// Staff reply — sends as the fixed "PreCheckd Trust & Safety" sender,
// lands in the recruiter's normal PreCheckd inbox like any other message.
router.post('/disputes/:fraudReportId/reply', async (req, res) => {
  try {
    const { fraudReportId } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).send('Reply body is required.');
    }

    const report = await FraudReport.findById(fraudReportId);
    if (!report || !report.matchedRecruiterId) {
      return res.status(404).send('Report or matched recruiter not found.');
    }

    await Message.create({
      fraudReportId,
      senderType: 'system',
      recipientType: 'recruiter',
      recipientId: report.matchedRecruiterId,
      body: body.trim(),
    });

    res.redirect(`/internal/disputes/${fraudReportId}`);
  } catch (error) {
    console.error('Error replying to dispute thread:', error);
    res.status(500).send('Server error');
  }
});

// Update a single report's status from the detail view
router.post('/fraud/:reportId/status', async (req, res) => {
  try {
    const { status, redirectTo } = req.body;
    const validStatuses = ['pending', 'reviewed', 'dismissed', 'confirmed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).send('Invalid status.');
    }

    await FraudReport.findByIdAndUpdate(req.params.reportId, { status });
    res.redirect(redirectTo || '/internal/fraud');
  } catch (error) {
    console.error('Error updating fraud report status:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;