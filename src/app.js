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
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const Recruiter = require('./models/Recruiter');
const Candidate = require('./models/Candidate');
const Message = require('./models/Message');
const ConnectionRequest = require('./models/ConnectionRequest');

assertEnv();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.locals.stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

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

// Makes logged-in state AND command-center widget data available to every
// template via res.locals. Runs on every request, so kept as light as
// reasonably possible — limited to a few small, indexed queries.
app.use(async (req, res, next) => {
  res.locals.loggedInRecruiterSlug = null;
  res.locals.loggedInCandidateSlug = null;
  res.locals.commandCenterMessages = [];
  res.locals.commandCenterUnreadCount = 0;
  res.locals.commandCenterRequests = [];
  res.locals.commandCenterVerifiedCount = 0;
  res.locals.commandCenterVerifiedTotal = 0;
  res.locals.commandCenterNudges = [];

  try {
    if (req.session.recruiterId) {
      const recruiter = await Recruiter.findById(req.session.recruiterId);
      if (recruiter) {
        res.locals.loggedInRecruiterSlug = recruiter.slug;

        const [recentMessages, unreadCount, recentRequests] = await Promise.all([
          Message.find({ recipientType: 'recruiter', recipientId: req.session.recruiterId })
            .sort({ sentAt: -1 }).limit(3),
          Message.countDocuments({ recipientType: 'recruiter', recipientId: req.session.recruiterId, readAt: null }),
          ConnectionRequest.find({ recruiterId: req.session.recruiterId })
            .sort({ createdAt: -1 }).limit(3).populate('candidateId', 'firstName lastName anonId')
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

    if (req.session.candidateId) {
      const candidate = await Candidate.findById(req.session.candidateId);
      if (candidate) {
        res.locals.loggedInCandidateSlug = candidate.slug;

        const [recentMessages, unreadCount, recentRequests] = await Promise.all([
          Message.find({ recipientType: 'candidate', recipientId: req.session.candidateId })
            .sort({ sentAt: -1 }).limit(3),
          Message.countDocuments({ recipientType: 'candidate', recipientId: req.session.candidateId, readAt: null }),
          ConnectionRequest.find({ candidateId: req.session.candidateId })
            .sort({ createdAt: -1 }).limit(3).populate('recruiterId', 'firstName lastName company')
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

  next();
});

app.get('/founding-recruiter-landing', (req, res) => {
  res.render('founding-recruiter-landing');
});

app.get('/founding-recruiter', (req, res) => {
  res.render('founding-recruiter');
});

app.use('/recruiter', recruiterProfileRoutes);
app.use('/candidate', candidateProfileRoutes);
app.use('/candidate', candidateEditRoutes);
app.use('/internal', internalRoutes);

const foundingRecruiterRoutes = require('./routes/founding-recruiter');
app.use('/api/founding-recruiter', foundingRecruiterRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/recruiter-dashboard', recruiterDashboardRoutes);
app.use('/candidate-dashboard', candidateDashboardRoutes);
app.use('/messages', messagesRoutes);
app.use('/', authRoutes);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;