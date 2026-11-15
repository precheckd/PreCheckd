// Stripe webhook endpoint (raw body, signature checked). The work is in services/billingWebhook.js.
const stripe = require('../config/stripe');
const stripeService = require('../services/stripeService');
const { handleEvent } = require('../services/billingWebhook');

async function handleWebhook(req, res) {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    await handleEvent(event, { stripe });
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook failed:', event.type, event.id, err.message);
    // 500 makes Stripe retry later.
    res.status(500).json({ error: 'webhook handler failed' });
  }
}

module.exports = { handleWebhook };
