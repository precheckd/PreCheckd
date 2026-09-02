const Recruiter = require('../models/Recruiter');

async function showSignupForm(req, res) {
  res.render('founding-recruiter', {
    title: 'Founding Recruiter Signup',
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
}

async function createSignup(req, res, next) {
  try {
    const { firstName, lastName, email, phone, company } = req.body;

    const recruiter = await Recruiter.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { firstName, lastName, phone, company },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ recruiterId: recruiter._id });
  } catch (err) {
    next(err);
  }
}

module.exports = { showSignupForm, createSignup };
