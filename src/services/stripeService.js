const stripe = require('../config/stripe');

async function createCustomer({ email, name, phone }) {
  return stripe.customers.create({ email, name, phone });
}

async function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, metadata }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
  });
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { createCustomer, createCheckoutSession, constructWebhookEvent };
