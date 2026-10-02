const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;

const { assertEnv } = require('./config/env');
const routes = require('./routes');
const webhookRoutes = require('./routes/webhookRoutes');
const recruiterProfileRoutes = require('./routes/recruiter-profile');
const authRoutes = require('./routes/auth');
const candidateRoutes = require('./routes/candidate');
const candidateProfileRoutes = require('./routes/candidate-profile');
const candidateEditRoutes = require('./routes/candidate-edit');
const candidateDashboardRoutes = require('./routes/candidate-dashboard');
const recruiterDashboardRoutes = require('./routes/recruiter-dashboard');
const messagesRoutes = require('./routes/messages');
const internalRoutes = require('./routes/internal');
const emailCheckerRoutes = require('./routes/email-checker');
const savedRecruitersRoutes = require('./routes/saved-recruiters');
const certificateRoutes = require('./routes/certificate');
const fraudRoutes = require('./routes/fraud');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const Recruiter = require('./models/Recruiter');
const Candidate = require('./models/Candidate');
const Message = require('./models/Message');
const ConnectionRequest = require('./models/ConnectionRequest');
const SavedRecruiter = require('./models/SavedRecruiter');
const FraudReport = require('./models/FraudReport');

assertEnv();

const app = express();

app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.locals.stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
app.locals.gaMeasurementId = process.env.GA_MEASUREMENT_ID || null;

// Referenced again below, where the admin-subdomain routing is set up —
// declared early so this same value can gate the GA tracking snippet in
// the shared layout, keeping internal staff page loads out of the public
// traffic numbers this is meant to measure.
const ADMIN_HOSTNAME = process.env.ADMIN_HOSTNAME || 'admin.precheckd.com';

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  store: new MongoStore({ 
    mongoUrl: process.env.MONGODB_URI
  }),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use('/webhooks', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function buildCandidateNudges(candidate) {
  const nudges = [];
  if (!candidate.profilePhotoUrl) nudges.push('Add a profile photo');
  if (!candidate.bio) nudges.push('Write a short bio');
  if (!candidate.workHistory || candidate.workHistory.length === 0) nudges.push('Add your work history');
  if (!candidate.educationHistory || candidate.educationHistory.length === 0) nudges.push('Add your education');
  if (!candidate.resumeUrl) nudges.push('Upload your resume');
  return nudges;
}

function buildRecruiterNudges(recruiter) {
  const nudges = [];
  if (!recruiter.profilePhotoUrl) nudges.push('Add a profile photo');
  if (!recruiter.bio) nudges.push('Write a short bio');
  if (!recruiter.yearsOfExperience) nudges.push('Add years of experience');
  if (!recruiter.specialties || recruiter.specialties.length === 0) nudges.push('Add your specialties');
  return nudges;
}

app.use(async (req, res, next) => {
  res.locals.isAdminHost = req.hostname === ADMIN_HOSTNAME;
  res.locals.loggedInRecruiterSlug = null;
  res.locals.loggedInCandidateSlug = null;
  res.locals.commandCenterMessages = [];
  res.locals.commandCenterUnreadCount = 0;
  res.locals.commandCenterRequests = [];
  res.locals.commandCenterVerifiedCount = 0;
  res.locals.commandCenterVerifiedTotal = 0;
  res.locals.commandCenterNudges = [];
  res.locals.commandCenterSavedRecruiters = [];
  res.locals.commandCenterFraudReports = [];
  res.locals.commandCenterFraudReportCount = 0;
  res.locals.commandCenterIsClaimAccount = false;

  // Set below if a suspended recruiter's session turns up — handled after
  // the try/catch so it doesn't short-circuit the candidate-session check
  // that follows it (same mistake as the claim-account branch above it).
  let destroySuspendedSession = false;

  try {
    if (req.session.recruiterId) {
      const recruiter = await Recruiter.findById(req.session.recruiterId);

      // A suspended account's session dies on its very next request —
      // nothing waits for them to log out or for a token to expire.
      if (recruiter && recruiter.isSuspended) {
        destroySuspendedSession = true;
      } else if (recruiter) {
        res.locals.loggedInRecruiterSlug = recruiter.slug;
        res.locals.commandCenterIsClaimAccount = recruiter.accountTier === 'unverified_claim';

        const [recentFraudReports, fraudReportCount] = await Promise.all([
          FraudReport.find({ matchedRecruiterId: recruiter._id }).sort({ createdAt: -1 }).limit(3),
          FraudReport.countDocuments({ matchedRecruiterId: recruiter._id })
        ]);
        res.locals.commandCenterFraudReports = recentFraudReports.map((r) => ({
          reasonCategory: r.reasonCategory,
          createdAt: r.createdAt
        }));
        res.locals.commandCenterFraudReportCount = fraudReportCount;

        // A claim account has no real profile, messages, or requests yet —
        // skip those widgets entirely rather than show empty/broken ones.
        if (!res.locals.commandCenterIsClaimAccount) {
          const [recentMessages, unreadCount, recentRequests] = await Promise.all([
            Message.find({ recipientType: 'recruiter', recipientId: req.session.recruiterId })
              .sort({ sentAt: -1 }).limit(3),
            Message.countDocuments({ recipientType: 'recruiter', recipientId: req.session.recruiterId, readAt: null }),
            ConnectionRequest.find({ recruiterId: req.session.recruiterId })
              .sort({ createdAt: -1 }).limit(3).populate('candidateId', 'firstName lastName anonId')
          ]);

          res.locals.commandCenterMessages = await Promise.all(recentMessages.map(async (m) => {
            if (m.senderType === 'system') {
              return {
                _id: m._id,
                senderName: 'PreCheckd Trust & Safety',
                preview: m.body.slice(0, 60),
                readAt: m.readAt
              };
            }
            const sender = m.senderType === 'recruiter'
              ? await Recruiter.findById(m.senderId).select('firstName lastName')
              : await Candidate.findById(m.senderId).select('firstName lastName');
            return {
              _id: m._id,
              senderName: sender ? `${sender.firstName} ${sender.lastName}` : 'Unknown',
              preview: m.body.slice(0, 60),
              readAt: m.readAt
            };
          }));
          res.locals.commandCenterUnreadCount = unreadCount;

          res.locals.commandCenterRequests = recentRequests.map((r) => ({
            _id: r._id,
            status: r.status,
            displayName: r.status === 'pending' ? `Candidate ${r.candidateId?.anonId || ''}` : `${r.candidateId?.firstName || ''} ${r.candidateId?.lastName || ''}`
          }));

          const recruiterChecks = [
            recruiter.domainVerifiedAt,
            recruiter.emailVerifiedAt,
            recruiter.phoneVerifiedAt,
            recruiter.identityVerifiedAt,
            recruiter.facialRecognitionVerifiedAt
          ];
          res.locals.commandCenterVerifiedTotal = recruiterChecks.length;
          res.locals.commandCenterVerifiedCount = recruiterChecks.filter(Boolean).length;
          res.locals.commandCenterNudges = buildRecruiterNudges(recruiter);
        }
      }
    }

    if (req.session.candidateId) {
      const candidate = await Candidate.findById(req.session.candidateId);
      if (candidate) {
        res.locals.loggedInCandidateSlug = candidate.slug;

        const [recentFraudReports, fraudReportCount] = await Promise.all([
          FraudReport.find({ reporterCandidateId: candidate._id }).sort({ createdAt: -1 }).limit(3),
          FraudReport.countDocuments({ reporterCandidateId: candidate._id })
        ]);
        res.locals.commandCenterFraudReports = recentFraudReports.map((r) => ({
          reasonCategory: r.reasonCategory,
          createdAt: r.createdAt
        }));
        res.locals.commandCenterFraudReportCount = fraudReportCount;

        const [recentMessages, unreadCount, recentRequests, savedRecruiters] = await Promise.all([
          Message.find({ recipientType: 'candidate', recipientId: req.session.candidateId })
            .sort({ sentAt: -1 }).limit(3),
          Message.countDocuments({ recipientType: 'candidate', recipientId: req.session.candidateId, readAt: null }),
          ConnectionRequest.find({ candidateId: req.session.candidateId })
            .sort({ createdAt: -1 }).limit(3).populate('recruiterId', 'firstName lastName company'),
          SavedRecruiter.find({ candidateId: req.session.candidateId })
            .sort({ savedAt: -1 }).limit(3).populate('recruiterId', 'firstName lastName company slug')
        ]);

        res.locals.commandCenterMessages = await Promise.all(recentMessages.map(async (m) => {
          const sender = m.senderType === 'recruiter'
            ? await Recruiter.findById(m.senderId).select('firstName lastName')
            : await Candidate.findById(m.senderId).select('firstName lastName');
          return {
            _id: m._id,
            senderName: sender ? `${sender.firstName} ${sender.lastName}` : 'Unknown',
            preview: m.body.slice(0, 60),
            readAt: m.readAt
          };
        }));
        res.locals.commandCenterUnreadCount = unreadCount;

        res.locals.commandCenterRequests = recentRequests.map((r) => ({
          _id: r._id,
          status: r.status,
          displayName: r.recruiterId ? `${r.recruiterId.firstName} ${r.recruiterId.lastName}` : 'Unknown'
        }));

        res.locals.commandCenterSavedRecruiters = savedRecruiters
          .filter((s) => s.recruiterId)
          .map((s) => ({
            slug: s.recruiterId.slug,
            displayName: `${s.recruiterId.firstName} ${s.recruiterId.lastName}`,
            company: s.recruiterId.company && s.recruiterId.company !== 'Not provided' ? s.recruiterId.company : null
          }));

        const candidateChecks = [
          candidate.emailVerifiedAt,
          candidate.phoneVerifiedAt,
          candidate.identityVerifiedAt,
          candidate.facialRecognitionVerifiedAt
        ];
        res.locals.commandCenterVerifiedTotal = candidateChecks.length;
        res.locals.commandCenterVerifiedCount = candidateChecks.filter(Boolean).length;
        res.locals.commandCenterNudges = buildCandidateNudges(candidate);
      }
    }
  } catch (error) {
    console.error('Error resolving command center data:', error);
  }

  if (destroySuspendedSession) {
    return req.session.destroy(() => next());
  }

  next();
});

// The internal dashboard lives on its own subdomain in production — a
// request to admin.precheckd.com is handled entirely by internalRoutes
// (mounted at root, so its own paths read as /login, /fraud, etc. with no
// /internal prefix) and never falls through to the public site's routes.
// Locally there's no custom DNS, so /internal still works as a dev-only
// convenience path — never relied on in production. (ADMIN_HOSTNAME itself
// is declared up near the top of this file, since the GA tracking-snippet
// gate needs it too.)
app.use((req, res, next) => {
  if (req.hostname === ADMIN_HOSTNAME) {
    return internalRoutes(req, res, () => res.status(404).send('Not found'));
  }
  next();
});

if (process.env.NODE_ENV !== 'production') {
  app.use('/internal', internalRoutes);
}

app.get('/founding-recruiter-landing', (req, res) => {
  res.render('founding-recruiter-landing');
});

app.get('/founding-recruiter', (req, res) => {
  res.render('founding-recruiter');
});

app.use('/recruiter', recruiterProfileRoutes);
app.use('/candidate', candidateProfileRoutes);
app.use('/candidate', candidateEditRoutes);
app.use('/candidate', certificateRoutes);
app.use('/fraud', fraudRoutes);

const foundingRecruiterRoutes = require('./routes/founding-recruiter');
app.use('/api/founding-recruiter', foundingRecruiterRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/email-checker', emailCheckerRoutes);
app.use('/api/saved-recruiters', savedRecruitersRoutes);
app.use('/recruiter-dashboard', recruiterDashboardRoutes);
app.use('/candidate-dashboard', candidateDashboardRoutes);
app.use('/messages', messagesRoutes);
app.use('/', authRoutes);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;