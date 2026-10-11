// Inbound email entry point (email foundation, roadmap #4).
//
// Resend posts an `email.received` webhook when mail arrives at an address on
// one of our receiving subdomains (in.precheckd.com for candidates,
// recruiters.precheckd.com for recruiters). The webhook carries metadata only;
// the body and attachments are fetched later with resend.emails.receiving.get.
//
// This first version only verifies the signature and acknowledges the event,
// so the webhook can be switched on in Resend before any routing exists.
// Alias lookup, sender screening and forwarding get added in handleReceived.
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function handleReceived(data) {
  // Metadata only: never log subjects, bodies or full addresses.
  const recipients = (data.to || []).length;
  console.log(`[inbound] email.received id=${data.email_id} recipients=${recipients} attachments=${(data.attachments || []).length}`);
}

// Express handler. Must be mounted with express.raw so the body is untouched
// (the signature is computed over the exact bytes Resend sent).
async function handleWebhook(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // 5xx so Resend retries once the secret is configured.
    console.error('[inbound] RESEND_WEBHOOK_SECRET is not set');
    return res.status(503).send('Not configured');
  }

  let event;
  try {
    event = resend.webhooks.verify({
      payload: req.body.toString('utf8'),
      headers: {
        id: req.get('svix-id'),
        timestamp: req.get('svix-timestamp'),
        signature: req.get('svix-signature'),
      },
      webhookSecret: secret,
    });
  } catch (err) {
    return res.status(400).send('Invalid signature');
  }

  try {
    if (event.type === 'email.received') {
      await handleReceived(event.data);
    }
  } catch (err) {
    // 5xx makes Resend retry; handlers must be safe to repeat.
    console.error('[inbound] handler failed:', err);
    return res.status(500).send('Handler error');
  }

  return res.status(200).send('ok');
}

module.exports = { handleWebhook, handleReceived };
