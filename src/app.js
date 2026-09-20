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
const internalRoutes = require('./routes/internal');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const Recruiter = require('./models/Recruiter');
const Candidate = require('./models/Candidate');

assertEnv();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Pass Stripe key to all templates
app.locals.stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

// app.use(helmet()); // Disabled for development

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

// Webhook routes need the raw request body for signature verification,
// so they must be mounted before the global JSON body parser below.
app.use('/webhooks', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Makes the logged-in state available to every template via res.locals,
// so the header nav can show a "My Profile" link for whoever is logged
// in, on every page site-wide, without each route computing this itself.
app.use(async (req, res, next) => {
  res.locals.loggedInRecruiterSlug = null;
  res.locals.loggedInCandidateSlug = null;

  try {
    if (req.session.recruiterId) {
      const recruiter = await Recruiter.findById(req.session.recruiterId).select('slug');
      if (recruiter) {
        res.locals.loggedInRecruiterSlug = recruiter.slug;
      }
    }

    if (req.session.candidateId) {
      const candidate = await Candidate.findById(req.session.candidateId).select('slug');
      if (candidate) {
        res.locals.loggedInCandidateSlug = candidate.slug;
      }
    }
  } catch (error) {
    console.error('Error resolving logged-in user for nav:', error);
  }

  next();
});

// Landing page for founding recruiters
app.get('/founding-recruiter-landing', (req, res) => {
  res.render('founding-recruiter-landing');
});

// Signup form for founding recruiters
app.get('/founding-recruiter', (req, res) => {
  res.render('founding-recruiter');
});

// Recruiter profile pages
app.use('/recruiter', recruiterProfileRoutes);

// Candidate profile pages (private, owner-only)
app.use('/candidate', candidateProfileRoutes);

// Candidate edit routes (private, owner-only)
app.use('/candidate', candidateEditRoutes);

// Internal admin tool — password-gated, staff only
app.use('/internal', internalRoutes);

const foundingRecruiterRoutes = require('./routes/founding-recruiter');
app.use('/api/founding-recruiter', foundingRecruiterRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/recruiter-dashboard', recruiterDashboardRoutes);
app.use('/candidate-dashboard', candidateDashboardRoutes);
app.use('/', authRoutes);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;