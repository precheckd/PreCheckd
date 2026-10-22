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
- Team and who it reports to: optional short line.
- Growth path: optional short line.
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

`src/services/applyGate.js` is a pure function with 26 tests (`node tests/apply-gate.test.js`). It is not wired to any screen yet. Choices made while building it that Kent has not explicitly confirmed:

- **On-site and hybrid jobs** are checked against the candidate's Work Areas the same way Remote in Area is (a candidate with no Work Areas drawn is asked to add them). Remote jobs skip the area check.
- **Shifts:** a posting marked "flexible" has no shift requirement; a candidate who ticked "flexible" satisfies any shift.
- **Availability:** a candidate with no available-from date is not blocked, even when the posting's start date is firm.
- **Account state** (verified, membership) is reported as blockers but ignored by `qualifies()`, which is for the "jobs you now qualify for" notices. Membership is not checked until billing exists.
- **Seniority labels** (what to call a posting that is not entry level) are not defined yet; only `isEntryLevel` exists.
- Every blocker ends with a `withdraw` action, and the engine returns all blockers at once, not just the first.
- The engine reads **real** skill levels (hidden skills count). The adapter that builds those facts, the geo check for Work Areas, and the certification and education catalogs come in step 2.
