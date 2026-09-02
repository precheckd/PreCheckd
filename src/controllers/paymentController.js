const Recruiter = require('../models/Recruiter');
const stripeService = require('../services/stripeService');

async function createCheckoutSession(req, res, next) {
  try {
    const recruiter = await Recruiter.findById(req.body.recruiterId);
    if (!recruiter) return res.status(404).json({ error: 'Recruiter not found' });
    if (!recruiter.phoneVerified) {
      return res.status(400).json({ error: 'Phone must be verified before payment' });
    }

    if (!recruiter.stripeCustomerId) {
      const customer = await stripeService.createCustomer({
        email: recruiter.email,
        name: `${recruiter.firstName} ${recruiter.lastName}`,
        phone: recruiter.phone,
      });
      recruiter.stripeCustomerId = customer.id;
      await recruiter.save();
    }

    const baseUrl = process.env.BASE_URL;
    const session = await stripeService.createCheckoutSession({
      customerId: recruiter.stripeCustomerId,
      priceId: process.env.STRIPE_FOUNDING_RECRUITER_PRICE_ID,
      successUrl: `${baseUrl}/founding-recruiter/success?recruiterId=${recruiter._id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/founding-recruiter`,
      metadata: { recruiterId: recruiter._id.toString() },
    });

    recruiter.stripeCheckoutSessionId = session.id;
    await recruiter.save();

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
}

async function handleWebhook(req, res, next) {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const recruiterId = session.metadata && session.metadata.recruiterId;
      if (recruiterId) {
        await Recruiter.findByIdAndUpdate(recruiterId, { paymentStatus: 'paid' });
      }
    }
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCheckoutSession, handleWebhook };
