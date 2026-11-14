# Billing spec (draft, Nov 14 2026)

Everything priced here was LOCKED by Kent on Oct 28 (see the roadmap memory). This file turns it into a build plan.
Build with Stripe TEST keys first, then swap to live keys. All of it sits behind `BILLING_ENABLED` so nothing changes until Kent flips it.

## What exists today
- `src/config/stripe.js`, `src/services/stripeService.js` (customer, one-time Checkout, webhook verify).
- `src/controllers/paymentController.js`: legacy one-time founding-recruiter checkout, sets `paymentStatus: 'paid'`. `/webhooks/stripe` already exists with raw body + signature.
- Stripe Identity sessions for ID checks (recruiters: `/founding-recruiter/create-identity-session`; candidates: Sumsub webhook).
- Env: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_FOUNDING_RECRUITER_PRICE_ID.
- No subscription state on Recruiter or Candidate; test credits are `TEST_CREDITS_PER_MONTH` + staff grants.

## Plans
Recruiters: $59/mo or $499/yr. Founding waves (annual only, price locked while subscribed): first 100 at $249, next 150 at $349, then $499. Payment is taken BEFORE the ID check. 5 open postings included. Add-ons: extra open-posting slot ($10 each for 1-5, $8 for 6-10, $6 for 11+, per month), test-credit pack ($39 per 3).
Candidates: $79 one-time verification fee (waived for the first 1,000; ID check still runs; card on file required; max 2 ID attempts), then $15/mo or $120/yr from signup. Browsing jobs is free; verification, tests and applying are paid.
Lapse: unfixed payment failure after a 14-day grace period, or cancellation.

## Build phases
1. Data + switch: `BILLING_ENABLED`; Recruiter/Candidate get `billing { customerId, subscriptionId, plan, interval, status, currentPeriodEnd, graceUntil, founding { wave, price } }`; a `BillingEvent` log (idempotent on Stripe event id).
2. Recruiter plan: Stripe Products/Prices (monthly, annual, wave 1, wave 2), Checkout in `subscription` mode, wave counting from paid subscriptions (reserve at checkout), webhook handlers (checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted), the gate (no posting/search/outreach without an active or in-grace subscription), 5-open-posting cap.
3. Candidate plan: verification fee (one-time) + subscription, founding-1,000 waiver counter, card-before-ID-check, ID attempt cap, gate on verification/tests/applying.
4. Billing page for both sides (plan, next charge, Stripe customer portal for card/cancel), receipts, failed-payment and grace-period emails (Resend), staff view.
5. Add-ons: slot subscription items with tiered pricing; test-credit packs; then candidate test credits (roadmap item 10) which depend on this.

## Open items for Kent
- Sales tax: turn on Stripe Tax?
- Did anyone already pay through the old one-time founding checkout? How do they carry over?
- Lapse for candidates: profile stays, testing and applying pause?
- Refund and cancellation wording (Terms, lawyer list).
- Stripe: which account, test keys, and webhook endpoint for the new events.
