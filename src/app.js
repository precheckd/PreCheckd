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
const candidateVideoRoutes = require('./routes/candidate-video');
const candidateWorkAreasRoutes = require('./routes/candidate-work-areas');
const candidateJobPreferencesRoutes = require('./routes/candidate-job-preferences');
const candidateSearchRoutes = require('./routes/candidate-search');
const connectionsRoutes = require('./routes/connections');
const fraudRoutes = require('./routes/fraud');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const Recruiter = require('./models/Recruiter');
const Candidate = require('./models/Candidate');
const Message = require('./models/Message');
const ConnectionRequest = require('./models/ConnectionRequest');
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

// Resolves who's logged in (for the top nav) plus the three counts that
// drive its badges: unread messages, requests waiting on this user to act,
// and fraud reports (about a recruiter / filed by a candidate).
app.use(async (req, res, next) => {
  res.locals.isAdminHost = req.hostname === ADMIN_HOSTNAME;
  res.locals.currentPath = req.path;
  res.locals.loggedInRecruiterSlug = null;
  res.locals.loggedInCandidateSlug = null;
  res.locals.commandCenterUnreadCount = 0;
  res.locals.commandCenterPendingRequestCount = 0;
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

        res.locals.commandCenterFraudReportCount = await FraudReport.countDocuments({ matchedRecruiterId: recruiter._id });

        // A claim account has no real messages or requests yet — skip
        // those counts rather than show empty/broken badges.
        if (!res.locals.commandCenterIsClaimAccount) {
          const [unreadCount, pendingRequestCount] = await Promise.all([
            Message.countDocuments({ recipientType: 'recruiter', recipientId: req.session.recruiterId, readAt: null }),
            // Only requests waiting on THIS recruiter to act — a request
            // they sent that's still awaiting the candidate's decision
            // isn't something for a badge to nag them about.
            ConnectionRequest.countDocuments({ recruiterId: req.session.recruiterId, status: 'pending', initiatedBy: { $ne: 'recruiter' } })
          ]);
          res.locals.commandCenterUnreadCount = unreadCount;
          res.locals.commandCenterPendingRequestCount = pendingRequestCount;
        }
      }
    }

    if (req.session.candidateId) {
      const candidate = await Candidate.findById(req.session.candidateId);
      if (candidate) {
        res.locals.loggedInCandidateSlug = candidate.slug;

        const [fraudReportCount, unreadCount, pendingConnectionCount, pendingFullAccessCount] = await Promise.all([
          FraudReport.countDocuments({ reporterCandidateId: candidate._id }),
          Message.countDocuments({ recipientType: 'candidate', recipientId: req.session.candidateId, readAt: null }),
          // Only requests waiting on THIS candidate to act — see the
          // identical comment on the recruiter branch above.
          ConnectionRequest.countDocuments({ candidateId: req.session.candidateId, status: 'pending', initiatedBy: { $ne: 'candidate' } }),
          // A recruiter's full-access (video + resume) request is also
          // waiting on this candidate; unanswered ones past their expiry
          // window no longer count.
          ConnectionRequest.countDocuments({
            candidateId: req.session.candidateId,
            status: 'accepted',
            fullAccessStatus: 'requested',
            $or: [{ fullAccessExpiresAt: null }, { fullAccessExpiresAt: { $gt: new Date() } }]
          })
        ]);
        res.locals.commandCenterFraudReportCount = fraudReportCount;
        res.locals.commandCenterUnreadCount = unreadCount;
        res.locals.commandCenterPendingRequestCount = pendingConnectionCount + pendingFullAccessCount;
      }
    }
  } catch (error) {
    console.error('Error resolving logged-in nav data:', error);
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
  res.render('founding-recruiter-landing', { pageTitle: 'PreCheckd - Recruiters' });
});

app.get('/founding-recruiter', (req, res) => {
  res.render('founding-recruiter', { pageTitle: 'PreCheckd - Founding Recruiter Signup' });
});

app.use('/verify', require('./routes/verify'));
app.use('/email', require('./routes/email-preferences'));
app.use('/recruiter', recruiterProfileRoutes);
app.use('/candidate', candidateProfileRoutes);
app.use('/candidate', candidateEditRoutes);
app.use('/candidate', certificateRoutes);
app.use('/candidate', candidateVideoRoutes);
app.use('/candidate', candidateWorkAreasRoutes);
app.use('/candidate', candidateJobPreferencesRoutes);
app.use('/fraud', fraudRoutes);

const foundingRecruiterRoutes = require('./routes/founding-recruiter');
app.use('/api/founding-recruiter', foundingRecruiterRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/email-checker', emailCheckerRoutes);
app.use('/api/saved-recruiters', savedRecruitersRoutes);
app.use('/recruiter-dashboard', recruiterDashboardRoutes);
app.use('/candidate-dashboard', candidateDashboardRoutes);
app.use('/candidate-search', candidateSearchRoutes);
app.use('/connections', connectionsRoutes);
app.use('/messages', messagesRoutes);
app.use('/', authRoutes);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;