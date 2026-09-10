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
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

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
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Webhook routes need the raw request body for signature verification,
// so they must be mounted before the global JSON body parser below.
app.use('/webhooks', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const foundingRecruiterRoutes = require('./routes/founding-recruiter');
app.use('/api/founding-recruiter', foundingRecruiterRoutes);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;