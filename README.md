# PreCheckd App

Node.js/Express web application for PreCheckd, starting with the founding recruiter signup flow.

## Stack

- Express + EJS (server-rendered views)
- MongoDB via Mongoose
- Stripe (checkout + webhooks)
- Sumsub (identity verification)
- Twilio Verify (SMS phone verification)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in real credentials.
3. `npm run dev` (or `npm start`)

## Founding recruiter flow

1. `GET /founding-recruiter` — signup form.
2. `POST /founding-recruiter` — creates/updates the recruiter record.
3. `POST /founding-recruiter/sms/send-code` / `verify-code` — Twilio Verify SMS OTP.
4. `POST /founding-recruiter/payment/checkout` — creates a Stripe Checkout session.
5. `GET /founding-recruiter/success` — after payment, creates a Sumsub applicant and renders the identity verification widget.
6. `POST /webhooks/stripe` / `POST /webhooks/sumsub` — async status updates from each provider.

## Structure

```
src/
  app.js            Express app wiring
  config/           env, database, and third-party client config
  controllers/       request handlers
  services/          third-party API wrappers (Stripe, Sumsub, Twilio)
  models/            Mongoose schemas
  routes/            route definitions
  middleware/         validation and error handling
views/               EJS templates
public/              static assets (css/js/images)
server.js            entry point
```
