# PreCheckd Job Board: Build Spec

Decided with Kent on Oct 21, 2026, one question at a time. This page is what the code is built from. The running discussion and reasons live in the memory doc "precheckd-job-board-spec". Where this page and the discussion differ, ask Kent.

**Who it is for:** agency / third-party recruiters (not internal recruiters). The poster is usually not the employer.
**Principle:** the point is the best possible connection. If an applicant does not meet a criterion, stop the application, tell them why, and offer two choices: fix it or withdraw. No "why not apply anyway."
**Scope rule:** the whole form is structured choices. No free-form titles, no custom screening questions, no resume upload, no years of experience anywhere.

---

## 1. The posting form (recruiter side)

### Basics
| Field | Rule |
|---|---|
| Skills | Pick up to 3 skills first, each with a minimum level (or none). |
| Job title | Not typed. After the skills are picked, matching catalog titles pop up and the recruiter chooses one. No match, or every match has a ruled-out skill, goes to Kent's manual queue. |
| Internal nickname | Recruiter-only label to tell their postings apart. Never shown to candidates. |
| Seniority | Not a field. Derived from the required skill levels. |
| Entry level | Means no minimum skill level on any skill. Labeled automatically. An entry-level posting asks for no skill level and no experience. |
| Hiring company | Required. The company where the job is. Typed with suggestions from company names already used on PreCheckd. No URL. |
| Authorization | Required checkbox: "I am authorized by this company to recruit for this role." |
| Posted by | Filled in automatically: the recruiter's name and verified badge. One owner per posting. No team features in v1. |
| Employment type | Dropdown: full-time, part-time, contract, temp, internship. Contract needs an end date or length. |
| Number of openings | Required number. Feeds the outcome record. |

No blind or confidential-client postings. Dropped fields: department, job function, requisition ID, reason for opening, hiring manager, interviewers, scorecards, languages, education field of study.

### Location and work arrangement
- Arrangement: **On-site, Hybrid, Remote, Remote in Area.**
- On-site, Hybrid, and Remote in Area (radius): a real street address is entered. It is never shown to candidates. On the public map the job is a pin that gets blurrier as you zoom in.
- Remote in Area: the recruiter says why it is limited. State restrictions: tick the states. In-person needs: a radius around an address.
- Hybrid: in-office days per week.
- Relocation offered: yes / no.
- Travel required: none, occasional, up to 25%, up to 50%, more than 50%.
- Shift: standard daytime, evenings, overnight, rotating, flexible (fixed choices).
- US-only site. No work-authorization or sponsorship field. Terms wording: must be authorized to work in the US. Never "US citizens only."

### Pay (one block, in this order)
1. **Line 1:** base pay type dropdown (salary or hourly) followed by the base pay range (min and max). Max can be no more than **25% above min**. A commission-only job must enter base pay of **0**, shown plainly.
2. **Line 2:** what the range is based on (pick any): verified skill level, certifications, location, internal pay band, negotiable. Never years of experience or education.
3. **Commission section:** two fields, minimum anticipated commission and average commission. No cap. **Every time** commission is entered a warning shows, for example "You are attesting that most employees in this position make commissions of $500k," with the notice that postings with false pay information will be removed and the recruiter's and company's posting privileges may be suspended.
4. **Bonus section:** checkboxes for bonus, equity, tips, each with an optional small note (for example "10% of salary").
5. **Benefits:** a grid of checkmarks: health, dental, vision, 401(k), 401(k) match, paid time off, paid holidays, paid sick leave, parental leave, tuition or training budget, equipment or stipend, remote or hybrid stipend, life or disability insurance, plus "other" (short text). Required.
6. **Good-faith box:** required on every posting, every state: "This pay is what I actually expect to pay for this role."

### Requirements (all required, all gate applications)
- Up to 3 skills with minimum levels (see Basics).
- **Education level** (verified): high school or GED, associate, bachelor's, master's, doctorate. A higher level satisfies a lower one. Level only.
- **Certifications:** up to 3 groups, up to 5 certs per group, picked from a fixed catalog. The candidate needs at least one verified, current cert from each group (OR inside a group, AND across groups). No automatic equivalence: the recruiter lists exactly what is accepted.
- **Security clearance:** none, Public Trust, Secret, Top Secret, TS/SCI. A higher clearance satisfies a lower one. Always labeled "reported by the candidate," never "verified."
- **Availability:** the posting has an in-seat start date and a "firm" flag. If firm, a candidate whose available-to-start date is later is blocked.
- **Attestation checkbox:** "I confirm these requirements are genuinely required for this job and lawful."
- No preferred or nice-to-have list.

### Description
- Role summary: required, short paragraph with a character limit.
- Responsibilities: required, 3 to 8 bullets.
- No day-to-day or about-the-company fields.
- Standing lines on every posting (written by PreCheckd, not editable): equal-opportunity statement; accommodation line (ask the recruiter or PreCheckd support); "This employer may require a background check and/or drug test as part of the hiring process."
- **Text scan on every free-text field.** Blocks, with the reason shown: phone numbers, emails, links, "message me on WhatsApp/Telegram"; "X+ years of experience"; "US citizens only"; wording that signals age, gender, or nationality preferences (for example "young," "digital native," "recent graduate," "native English speaker," "he/she").

### Dates and visibility
- Applications-close date: max about 45 days. In-seat start date (and the firm flag above).
- Every posting is public. No unlisted, internal-only, sponsored, or confidential options.
- At the close date the posting goes to "Awaiting outcome" (see the outcome gate in the roadmap, item 3).

---

## 2. Candidate profile changes

- **Shifts:** replace the messy week-and-hours availability with checkboxes of the shifts they are willing to work (same five choices as the posting).
- **Clearance:** new self-reported field. Opt-in to show it in recruiter search (off by default). Hidden clearance appears only in partial matches in search. The apply gate always uses the real reported value.
- **Available to start:** a date on the profile.
- **Work Areas:** already built. This is the location used for area checks (not the home address).
- **Education:** verified education entries carry a level. The apply gate uses verified entries only.
- **Certifications:** the gate uses verified, current certs. Expired certs do not count.
- Skills: unchanged. The apply gate uses the **real** level even if the candidate hides the skill from recruiters. In recruiter search, a hidden skill counts as "not shown" (partial match only).

---

## 3. Apply gate (the rules engine)

**Who can see a posting:** the public, logged out, sees the basics (title, company, pay, city and state, skills and requirements), never the street address. Logged-in members see every open posting with a clear "why you do not qualify" message. A recruiter's dashboard lists only their own postings. Recruiters cannot apply. A closed posting shows "This position is closed," not an error.

**Who can apply:** a candidate who is
1. logged in with a fully verified account (email, phone, identity);
2. meeting every criterion on the posting;
3. applying before the close date and not already applied;
4. in good standing with that recruiter (not blocked by them);
5. a current paying member (decided when billing is built).

A candidate who is not a member yet goes through sign-up and verification first, then returns to the job.

**Messages (one per failing criterion, always "fix it or withdraw"):**
- Skill level missing: "This job requires an Intermediate skill score for Linux which you do not currently possess. Would you like this skill certification track sent to you?" Yes starts the skill ladder track; the skill goes on their profile whether or not they get the job.
- Retake lock (60 days): the retake date, not the track offer.
- Result older than 12 months: "needs a retake."
- Result under integrity review: "being reviewed," no reason.
- Certification missing: "This job requires one of: Security+ or CISSP. You do not have any of these verified." Expired: "Your Security+ expired on [date]."
- Education not yet verified: "Your degree is being verified; we will notify you the moment it is done." Notice sent when it clears.
- Clearance, shift, area, availability: name the criterion, link back to the profile to edit, then apply again.
- When a blocked criterion later clears (test passed, education verified), the candidate gets a notice that they can now apply.

**Applying:**
- Applying shares the full profile, video, and resume with that recruiter. The apply screen says so plainly.
- Applying creates a connection automatically. The connection stays until either party closes it. On rejection the shared access stops but the connection stays.
- No resume upload, no cover letter, no extra attachments or links, no custom screening questions, no salary-expectation question. Applying means accepting the posted pay range.

---

## 4. Recruiter pipeline and notices

- New applicants: a bell right away, plus the new applicants in the recruiter's daily summary email (a setting turns the email off).
- Fixed pipeline stages, no custom stages: applied, screening, interviewing, offer, hired, rejected. Stage changes sync to the candidate's tracker.
- Rejection requires a reason from a short fixed list. The candidate sees only a neutral category.
- Candidates: a **bell on every new job they qualify for**, and the **full list in the weekly recap email**. Respect the open-to-opportunities setting.
- Skipped for now: an automatic recruiter response-time stat.

---

## 5. Legal and lawyer-review list

- US-only wording: "must be authorized to work in the US," never "citizens only."
- NYC automated employment decision tool law vs our rule-based apply gates (we use rules, no AI scoring).
- Hard education and other requirements and job-relatedness (the attestation checkbox helps).
- False-pay and unauthorized-client removal and suspension wording in the Terms.
- Retention, outcome gate, and hire-confirmation clauses already on the lawyer list.

---

## 6. Build phases (proposed)

1. **Rules engine first.** A pure function that takes a candidate and a posting and returns the list of unmet criteria and their messages. Fully tested before any screen exists.
2. **Candidate profile changes:** shift checkboxes, clearance, available-to-start date, education level, certification catalog and verified-cert check.
3. **Posting model and recruiter form,** with the text scan, title catalog and skill popup, company suggestions, pay block and validation, and the manual queue for no-title-match. Model each posting with a **source** flag (listed on PreCheckd vs external link) now, for the later pre-qualification service.
4. **Public posting pages:** shareable link, link previews with no address, closed state, public job list with blurred map pins, search-engine job markup.
5. **Apply flow:** the gate messages, fix-or-withdraw, auto-connection with full access, pipeline board, stage sync to the tracker, rejection reasons, bell and summary alerts.
6. **Notices:** now-qualify bells and weekly list, education-verified and test-passed notices.
7. **Close date and outcome gate:** awaiting outcome, the recruiter freeze, hire-confirmation email, closure notices (already designed on the roadmap, item 3).

Depends on billing (later): the paying-member check, posting credits, plan limits.

## 7. Later, not in v1

- Connection updates feed (after the Job Board; timing for Kent to decide).
- Pre-qualification service for jobs posted elsewhere (post-launch, with the verification-as-a-service idea).
- Team features for recruiters (post-launch idea).
- Automatic recruiter response-time stat.
- Preset certification groups (for example government-approved cyber cert lists).
- Optional confidential-client option if agencies push back.

---

## 8. Engine notes (step 1, built Oct 22)

`src/services/applyGate.js` is a pure function with 26 tests (`node tests/apply-gate.test.js`). It is not wired to any screen yet. Choices made while building it. Kent said to go ahead on Oct 22, so the first three are accepted; the rest are still open to change:

- **On-site and hybrid jobs** are checked against the candidate's Work Areas the same way Remote in Area is (a candidate with no Work Areas drawn is asked to add them). Remote jobs skip the area check.
- **Shifts:** a posting marked "flexible" has no shift requirement; a candidate who ticked "flexible" satisfies any shift.
- **Availability:** a candidate with no available-from date is not blocked, even when the posting's start date is firm.
- **Account state** (verified, membership) is reported as blockers but ignored by `qualifies()`, which is for the "jobs you now qualify for" notices. Membership is not checked until billing exists.
- **Seniority labels** (what to call a posting that is not entry level) are not defined yet; only `isEntryLevel` exists.
- Every blocker ends with a `withdraw` action, and the engine returns all blockers at once, not just the first.
- The engine reads **real** skill levels (hidden skills count). The adapter that builds those facts, the geo check for Work Areas, and the certification and education catalogs come in step 2.

---

## 9. Candidate profile changes (step 2, built Oct 22)

Tests: `node tests/geo.test.js`, `tests/profile-facts.test.js`, `tests/profile-screens.test.js` (plus `tests/apply-gate.test.js`). Nothing here is wired to an apply screen yet; the adapter is ready for step 3.

- **Shifts** replace the days-and-hours picker. Candidate Job Preferences has five checkboxes (`Candidate.shifts`). Recruiter search has a Shift dropdown: confirmed matches first, candidates who never chose shifts below ("ask directly"), candidates who chose other shifts dropped. Flexible counts as any shift. The old `availableDays/StartTime/EndTime` fields are still on the record but nothing reads them.
- **Available to start** (`availableFrom`, optional date) on Job Preferences.
- **Clearance:** the self-reported field already existed. Added the opt-in `showClearanceInSearch` (off by default) and a recruiter search filter ("at least Secret", etc.). Only opted-in candidates can be matched; the rest fall in the "ask directly" group. The apply gate always reads the real value ("other" counts as none).
- **Education level:** each education entry has a Level dropdown (high school or GED, associate, bachelor's, master's, doctorate). Older entries are pre-filled with a guess from the degree text, which the candidate confirms. Changing the level makes a new, unverified entry (so a verified degree cannot be upgraded by editing). The admin verify screen shows each entry's level.
- **Certification catalog:** `src/content/certCatalog.js`, a starter list of about 45 certifications with aliases (Credly titles included). A candidate's cert counts toward a posting only when its name matches the catalog, and it is verified and unexpired. Cert names on Edit Profile now suggest catalog names. **To add a certification, add a line to that file.** Unlisted certs still show on the profile; they just cannot be required.
- **Adapter:** `src/services/applyFacts.js` builds the gate's facts from a Candidate: real skill levels (hidden included), the 60-day lock, "being reviewed" for held results, education, certs, clearance, shifts, start date, area.
- **Location check:** `src/utils/geo.js`, pure JavaScript. A posting's `areaRule` is `{ point }` (on-site, hybrid), `{ point, radiusMiles }` or `{ states: [...] }` (Remote in Area). Any overlap with a candidate's drawn Work Areas counts. State outlines are Census boundaries in `src/data/us-states-10m.topo.json`.
- **Still open:** seniority labels; whether a catalog miss should alert Kent (right now it silently does not count); step 3 must save `areaRule` on each posting (geocode the address once at save time).

---

## 10. Posting model and recruiter form (step 3, built Oct 22)

Tests: `node tests/text-scan.test.js`, `posting-validation.test.js`, `posting-location.test.js`, `recruiter-jobs-route.test.js` (the route test stubs the database; there is no MongoDB in the build sandbox, so the first live post is the real end-to-end check).

- **Where:** recruiters open **My job postings** from the account menu (`/recruiter-jobs`), then **Post a job**. Only an active, fully verified, unsuspended recruiter can post. The public `/jobs` pages come in step 4.
- **Form sections:** (1) skills and title, (2) company, (3) job details, (4) location and schedule, (5) pay, (6) requirements and dates, (7) description. Every rule from sections 1 to 5 of this spec is enforced on the server in `src/services/postingValidation.js` (pay width 25%, commission-only forces base 0, commission warning accepted every time, benefits grid or "none", good-faith box, up to 3 cert groups of 5, close date 1 to 45 days out, start date not before close, 3 to 8 responsibilities, attestation boxes).
- **Title:** `src/content/jobTitles.js` (41 starter titles). A title is offered when it covers EVERY skill the recruiter picked, so fewer skills gives more titles. No fit: the recruiter taps "Ask us to add a title", which lands in the admin **Catalog Requests** page. **The skill keys in that file must match the keys of the tests you build** (for example `linux`, `agile`, `cloud`); fix any that differ.
- **Seniority** (wording confirmed by Kent, Oct 22): no minimum level on any skill = Entry level, highest minimum Foundational = Junior, Intermediate = Mid-level, Advanced = Senior, Expert = Lead / Principal.
- **Free-text scan:** `src/utils/textScan.js` blocks emails, phone numbers, links, WhatsApp/Telegram/"text me" wording, "X+ years of experience", "citizens only", and age/gender/nationality wording (young, digital native, recent grad, native English speaker, he/she). `.NET`, `Node.js` and company names like Booking.com are fine.
- **Location:** the address is looked up once when the posting is saved (US Census geocoder, OpenStreetMap as backup). The saved rule (`areaRule`) is what the apply gate checks. Candidates only ever get city and state. The private address is shown to the posting's owner only.
- **Catalog Requests** (admin dashboard card): certifications candidates saved that are not in `certCatalog.js`, and job titles recruiters could not find. Add the line to the catalog file, then Mark added.
- **Not built yet in step 3:** editing a posted job (a recruiter can close it; to change requirements, post a new one), company suggestions come only from earlier postings (none exist yet), posting limits per plan (waits for billing), the awaiting-outcome gate at the close date (step 7).

## 11. Editing an open posting (built Oct 22)

- Recruiters can edit an **open** posting: every field, same rules as posting. Closed postings cannot be edited (409 page).
- The saved address is not looked up again unless it changed. The commission statement must be confirmed again on every edit (never pre-ticked).
- Close date may stay today or move later, up to 45 days after the **first** posting date, never into the past.
- Every save is logged on the posting (`editedAt`, `edits[]` with the parts changed: title and skills, company, job details, location, pay, requirements, dates, description; last 30 kept). The internal nickname is not logged.
- **Decided (Kent, Oct 22), built in step 5 when applications exist:** if an edit adds or tightens a requirement (skill added or level raised, education, certification, clearance, shift, area, firm start date), applicants who no longer meet it are **withdrawn automatically** and told which requirement changed and how to fix it (fix-or-withdraw wording). Before saving, the recruiter sees a **pop-up with how many applicants will be withdrawn** and must confirm. Any other change (pay, description, loosened requirements, dates, etc.) withdraws no one, but **all current applicants are notified** of what changed (Kent, Oct 22).

## 12. Public posting pages (step 4, built Oct 22)

- `/jobs` lists every open posting (search by title, company, skill or place; filter by arrangement) with a map. `/jobs/<id>/<title-company>` is the shareable link; a wrong or missing words part redirects (301) to the right one.
- Public view: title, company, city and state, pay, skills and requirements, description, standing lines, the verified recruiter who posted it. Never the street address, internal label or exact point.
- **Map:** each on-site, hybrid or radius-limited posting is a 2.5-mile circle that contains the real spot but is not centred on it (offset from a server secret, same every time). Zoomed in, the circle fills the screen, so it reads as an area, not a pin.
- **Link previews:** title, company, place, pay and skills; no address. Closed or past-due postings show "This position is closed." (status 200, `noindex`, no job markup).
- **Search engines:** schema.org JobPosting markup (city and state only, salary range, remote marked as telecommute) and `/jobs/sitemap.xml`. After launch, submit the sitemap once in Google Search Console.
- **Viewers:** guest sees sign-up / log-in; candidate sees what they are missing with fix links (the gate runs live); recruiters cannot apply; the owner gets a manage link. The Apply button arrives in step 5. "Jobs" is in the top nav.
- **For step 5:** log-in and sign-up do not yet return the person to the job they came from; add that.

## 13. Apply flow (step 5, built Oct 22)

- **Apply:** `/jobs/<id>/apply` is the last screen. It says plainly that applying shares the full profile, video and resume with the recruiter, accepts the posted pay, and means expecting an interview. The same gate runs again on submit, so a blocked candidate cannot apply by posting directly.
- **Auto-connect:** applying creates (or accepts) a connection with the posting's recruiter and grants full access. Withdrawing stops the access (unless another live application with that recruiter remains); the connection stays.
- **Tracker:** an entry is created on the candidate's Application Tracker (source `precheckd`) and set to withdrawn if they withdraw or are withdrawn.
- **Recruiter:** bell "New applicant for ...", and `/recruiter-jobs/<id>/applicants` lists active applicants with a link to the full profile. The "Applicants (N)" button is on the posting page.
- **Withdraw:** candidate button on the job page; applying again later revives the same application.
- **Edits with applicants (decided Oct 22):** an edit that adds or tightens a requirement withdraws applicants who now fail something they did not fail before (so an unrelated edit never sweeps up someone whose own situation drifted). The recruiter sees a pop-up with the count before saving; the server also refuses to save without the confirmation (checkbox fallback). Withdrawn candidates get a bell message and the job page shows what changed and how to fix it. Any other change withdraws no one and every current applicant gets a "was updated (parts)" bell.
- **Return to the job:** "Sign up to apply" and "Log in" on a job page remember the job. Login sends a fully verified candidate straight back; anyone still setting up sees a "Go back to it" bar until they visit the job.
- **Not built yet:** recruiter pipeline stages and rejection reasons, email versions of these notices (step 6), "blocked by recruiter" (there is no candidate-block feature yet, so the gate input is always false), membership check (billing).

## 14. Pipeline stages and notices (step 6, built Oct 22)

**Pipeline.** Fixed stages: applied, screening, interviewing, offer, hired, not moving forward (rejected). The recruiter moves an applicant on `/recruiter-jobs/<id>/applicants`; every move is a bell to the candidate and syncs to their Application Tracker (hired shows as offer with a "Hired through PreCheckd" note). Not moving forward needs one reason from a fixed list (position filled, other candidates, not the right fit, role on hold or changed, candidate stopped responding); the candidate sees only a neutral sentence ("The employer is moving forward with other candidates."), never the reason. Rejecting stops the shared profile access and keeps the connection. Hired and rejected are final in v1, and a rejected applicant cannot apply again.

**"You qualify" bell.** Once per candidate per job, for fully verified candidates who are open to opportunities and meet every requirement (ready to apply). Triggers: a job is posted or edited; the candidate's own profile changes (a passed test, a verified degree or cert, an edit), checked about 20 seconds after a save and at most every 5 minutes. A candidate withdrawn by a requirement change is told again when they meet the new one. The first-time "you can now apply" notice is the same bell.

**Monday recap email.** New section "Jobs you qualify for": every open job the candidate can apply to right now and has not applied to (up to 10), with links. A recap with only jobs still counts as worth sending.

**Recruiter daily email.** Weekdays 8:00-10:59 ET, once per ~20 hours, only when there are new applicants: counts per posting with links, no candidate details. Checkbox on My job postings turns it off.

**Not built / limits:** no email version of the bell notices (only the Monday list); the candidate-side sweep checks every verified candidate when a job is posted (fine at launch size, batch it if the candidate count grows past a few thousand); identity or phone verification done by webhook does not trigger a sweep by itself (the next profile save or the Monday email picks it up).


## 15. Close date and outcome gate (step 7, built Oct 22)

- **No silent expiry.** When a posting's close date passes it becomes `awaiting_outcome` (checked hourly and on every recruiter request). Public pages treat it as closed.
- **The gate.** A recruiter who owes an outcome is redirected from every page to `/recruiter-jobs/<id>/outcome` (JSON requests get 423). Not dismissable. Exempt: log out, Terms, Privacy, billing, hire-confirmation links, webhooks, static files, the admin host. If the check itself errors, the recruiter is let through.
- **Outcome form** (also used to end a posting early, replacing the old "Close this posting" button): hired through PreCheckd (pick up to the number of openings from live applicants; they move to Hired), hired elsewhere (name + business work email; personal domains refused), not filled (reason), cancelled (reason). "Other" needs a note; notes are scanned for contact details.
- **Applicants.** Everyone still in play and not hired is closed out: status rejected, reason `posting_closed`, neutral text ("The position has been filled." / "did not fill" / "was cancelled"), tracker updated, access released, bell. The recruiter's reason is never shown to them.
- **Hired elsewhere.** A one-click confirmation email goes to the work address (token stored hashed, valid 30 days). The page names the title and company, never the person or the recruiter. "No" flags the posting `hire_denied` and alerts staff.
- **Reminders.** 3 days and 1 day before close (each once), then daily once paused. Mornings 8:00-10:59 ET. Emails plus a bell for the upcoming ones.
- **Posting form.** New required acknowledgment that the outcome must be recorded when applications close.
- **Repost flag.** Same recruiter, same title, within 30 days of a cancelled posting: flagged `repost_after_cancel` and staff alerted.
- **Not built:** posting credit-back and the Trusted tier (depend on billing), a staff view of unconfirmed or denied hires, manual/LinkedIn audit of "hired elsewhere", a billing/cancel page does not exist yet (the exempt path is reserved). Lawyer review list: outcome gate, hire confirmation emails, NYC AEDT.

## 16. Job Board leftovers (built Oct 22)

- **End connection.** Either side can end an accepted connection from /connections with a required reason. Candidate reasons: never contacted me about a real opening, irrelevant roles, pushy, asked for off-platform contact or sensitive information (staff alert), suspicious (staff alert), just not interested. Recruiter reasons: role filled, not a fit, candidate did not respond, inappropriate behavior (staff alert), other. "Other" needs a note; notes are scanned for contact details. The status becomes `ended`, so messaging and shared access stop everywhere that checks for `accepted`. The other side gets only "A connection was ended." and never the reason. Live applications between the two: a candidate ending withdraws them; a recruiter ending closes them as rejected with "The recruiter ended this connection." A candidate who ended a connection cannot be sent a new request by that recruiter.
- **30-day survey.** Hourly job: 30 days after a connection was accepted the candidate gets a bell with a private survey (has the recruiter contacted you about a real opening; were they respectful; optional note). Internal only, never shown to the recruiter. "Not a real opening" or "not respectful" alerts staff.
- **Send this job to a connection.** On the recruiter's open posting: the public link to copy, and a Send button that posts the link as an ordinary message to a chosen connection. Closed jobs cannot be sent.
- **Staff Hire Review** (admin /hire-review, dashboard card): jobs flagged `hire_denied` or `repost_after_cancel`, and "hired elsewhere" confirmations unanswered after 7 days. Clear flag marks it reviewed.
- **Email a job to a non-member.** A third outreach template, `job`, used only from the recruiter's own open posting page (the form there takes a first name and an email). It goes out through the normal outreach rules: verified recruiters only, daily and monthly caps, one email per address per 30 days, the do-not-contact list, the verified badge and the recipient's opt-out or scam-report page. The posting link is generated by the server, so the general compose form cannot use this template.
- **Early survey.** A recruiter who ends a connection within 14 days of it starting triggers the candidate's survey 3 days after the ending.
- **Recruiter dispute path: not built, on purpose.** A recruiter only ever sees "A connection was ended." with no reason, so there is nothing to dispute. If staff act against a recruiter (suspension, an outreach pause), the existing Dispute Inbox is the path.
- **Not built:** retention period for endings and surveys (lawyer list), per-recruiter termination-rate screen.
