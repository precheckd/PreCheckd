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

## Status (Nov 14, 2026)
- Phase 1 built (billing state, BILLING_ENABLED, lapsed-candidate page).
- Phase 2 built, recruiter side: prices created in Stripe on first use by lookup key (`precheckd_recruiter_monthly|annual|founding_1|founding_2`), Checkout in subscription mode with automatic tax, founding spot held 35 minutes at checkout and locked when first paid, webhook handlers (idempotent by event id), recruiter gate (posting, applicants, candidate search/profiles, outreach email), 5-open-posting cap (+ bought slots later), postings of lapsed recruiters hidden from the board and job alerts, /billing page with Stripe customer portal, payment step before the ID check at signup.
- Phase 3 built, candidate side: $15/month or $120/year plus the one-time $79 fee in one Checkout (fee waived for the first 1,000 'Founding Candidates', spot held 35 minutes and kept for life once paid; never charged to someone already ID-verified or who paid before), payment before the ID check (the signup page sends unpaid candidates to /candidate-billing and back to the ID step), ID checks capped at 2 sessions (untouched sessions are reused), renewal/grace banners on the skills page, same webhooks.
- Phase 4 built: PreCheckd emails for membership started, payment trouble (with the date access ends), cancellation scheduled and membership ended (sent only on a real status change; Stripe still sends card receipts and its own failed-card notice), and a staff Billing page (members by status, founding spots, payment trouble, cancellations, latest Stripe events).
- Not yet: add-ons and credit packs (phase 5).

## Stripe dashboard settings needed (once)
1. Webhook endpoint `/webhooks/stripe` must send: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed.
2. Settings > Tax: turn on Stripe Tax, set the business address and register where required.
3. Settings > Billing > Customer portal: turn on, allow card update, invoices and cancel at end of period.
4. Settings > Billing > Subscriptions and emails: failed-payment retries should run at least 14 days (our grace period), then cancel the subscription. Turn on Stripe's failed-payment and receipt emails until ours exist.

## Open items for Kent
- Sales tax: turn on Stripe Tax?
- Did anyone already pay through the old one-time founding checkout? How do they carry over?
- Lapse for candidates: profile stays, testing and applying pause?
- Refund and cancellation wording (Terms, lawyer list).
- Stripe: which account, test keys, and webhook endpoint for the new events.

## Status: phase 5 (add-ons and credits)
- 5A/5B: recruiter posting slots (separate monthly subscription, graduated $10/$8/$6) and test-credit packs ($39 = 3).
- 5C: candidate skill-test credits. 3 a month from the member-since day, no rollover; spent only when a NEW skill test is started
  (continuing, recruiter-requested, role, title, finalist and custom tests are free); unopened expired invites refund. "Request more"
  (one open at a time) is approved by hand at /credit-requests and adds never-expiring bonus credits. Enforced only while BILLING_ENABLED.

## Pricing change (Nov 15)
- Standard recruiter price: $99/month, $799/year (was $59/$499). Prices are made in Stripe by lookup key; if the amount in code differs from an existing price, a new price is created and the key moves to it.
- Four annual steps, 1,000 recruiters: FOUNDERS (first 250) $249 x100, $349 x150, price LOCKED while subscribed. EARLY ACCESS (next 750) $449 x250, $549 x500, first year only, then renews at $799 (standard annual price + one-time Stripe coupon, id precheckd_early_access_<cents>). Nothing locked for Early Access.
- Monthly is always the standard $99. Founder/Early Access is annual only, once per person.
- To do: confirm Stripe's renewal reminder email is on (the billing page promises an email before an Early Access renewal); lawyer list: auto-renewal disclosure, "regular price" wording.
