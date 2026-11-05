// The questions on /ask. Each row opens to the text answer on the left and, when the
// row has a video, the clip on the right. A row with video: null is text only; to add
// its clip later, upload the mp4 to the precheckd-marketing bucket under /videos and
// set video to { file: 'name-without-.mp4' } (add poster: true if /img/<name>-poster.png exists).
//
// Facts here must match src/content/chatKnowledge.md (the chat assistant's only source).
// tests/ask-page.test.js checks the launch prices against it. Keep claims to what the
// site does today, e.g. "recruiters are verified", never "every posting is verified".

const FEEDBACK_LINE = 'When a recruiter passes on you, or closes a job without choosing you, they have to pick an area for you to work on, and you see it.';

function costParagraphs(billingLive) {
  if (!billingLive) {
    return [
      'Paid plans are not live yet. Founding recruiters currently verify at no cost and get complimentary profile hosting for a limited introductory period.',
      'Browsing jobs is free. Questions about future pricing: hello@precheckd.com.'
    ];
  }
  return [
    'Browsing jobs is free. Candidates pay a one-time $79 verification fee, then $15 a month or $120 a year. The verification fee may be waived for early candidates, so check the signup page. A card is required at signup, and the fee is non-refundable once the ID check runs.',
    'Recruiters pay $59 a month or $499 a year. That includes 5 open job postings at a time and 3 test credits a month. Extra job slots are $10 each a month (1 to 5), $8 each (6 to 10) and $6 each (11 or more). Extra test credits are $39 for 3.',
    'Founding recruiters get a lower yearly rate, locked in while the membership stays active. Spots left are shown on the recruiter signup page.'
  ];
}

function getAnswers({ billingLive = false } = {}) {
  return [
    {
      id: 'why-paying',
      q: 'Why am I paying?',
      featured: true,
      open: true,
      paras: [
        'We know times are tough, especially for people looking for a job. So you should know exactly where your money goes.',
        'Most job sites charge you and give you nothing you can check. Here, the money pays for things you can see.',
        'Recruiters go through an identity check, so you know a real person is behind the job. Your skills are proven by tests instead of claimed on a resume. And ' + FEEDBACK_LINE.charAt(0).toLowerCase() + FEEDBACK_LINE.slice(1) + ' No more silence.',
        'Messages are scanned for scams, bad actors get removed, and a scam checker shows how old a sender\'s domain is and whether we\'ve had reports about that address.',
        'Browsing jobs is free. Verifying, testing and applying are what the membership covers. Our motto is trust, but verify.'
      ],
      links: [{ href: '#cost', label: 'See the prices' }],
      video: null
    },
    {
      id: 'what-is',
      q: 'What is PreCheckd?',
      paras: [
        'PreCheckd is a hiring site for technical and IT roles where recruiters and candidates are both identity-verified. Recruiters can search candidates by verified skills and levels. Candidates can browse jobs and know the recruiter behind each one is a verified person.',
        'Candidates prove their skills with tests that run from Basic to Expert.'
      ],
      links: [{ href: '/candidate-signup', label: 'Get verified' }, { href: '/recruiter-landing', label: 'I\'m a recruiter' }],
      video: { file: 'ask-what-is-precheckd', poster: true }
    },
    {
      id: 'verification',
      q: 'How does verification work?',
      paras: [
        'You confirm your email, confirm your phone by text message, then complete an identity check with a government-issued photo ID and a live selfie. The check is run by our partner, Stripe Identity. It usually takes a few minutes.',
        'Recruiters do not see your ID documents. For now, only US government-issued IDs can be verified, and you must be at least 18.',
        'Jobs and degrees on your profile are checked too. We first try to confirm them with the employer or school, which takes about a week. If that does not work, we ask you for help, such as documents.'
      ],
      links: [{ href: '/safety', label: 'Safety Center' }],
      video: { file: 'ask-how-verification-works', poster: false }
    },
    {
      id: 'cost',
      q: 'What does it cost?',
      paras: costParagraphs(billingLive),
      links: [],
      video: null
    },
    {
      id: 'skill-tests',
      q: 'How do the skill tests work?',
      paras: [
        'Each skill has up to four tests: Basic, Intermediate, Advanced and Expert. You start at Basic, and passing a test unlocks the next one. You pass a test with at least 80% of the questions right. Tests draw from a question bank, so no two attempts are the same.',
        'The Expert exam is longer with a much higher pass line: 19 of 20 correct earns Master, and all 20 earns Grandmaster.',
        'Our test provider checks each attempt for suspected cheating or AI use. A flagged attempt is held and a person at PreCheckd reviews it before anyone sees it. A flag alone is not a finding.'
      ],
      links: [{ href: '/skills-explained', label: 'Skills explained' }],
      video: { file: 'ask-skill-tests', poster: true }
    },
    {
      id: 'skill-levels',
      q: 'What do the skill levels mean?',
      paras: [
        'Foundational means you handle the core, entry-level questions. Intermediate means everyday, working-level questions. Advanced means you handle working-level questions and can solve some of the hard ones.',
        'Master means you passed the Expert exam. Grandmaster means you answered every Expert question correctly, and it is a badge on top of Master.',
        'You choose which skills recruiters can see. Recruiters never see a percentage for a skill test, and results older than 12 months show as needing a retake.'
      ],
      links: [{ href: '/skills-explained', label: 'Skills explained' }],
      video: { file: 'ask-skill-levels', poster: false }
    },
    {
      id: 'privacy',
      q: 'Who can see my information?',
      paras: [
        'Recruiters see candidates in anonymized form until a candidate accepts a connection. Your email and phone number are not on your profile. Contact details are shared with another member only after you connect and choose to share them, and you can end a connection at any time.',
        'We never sell your information and do not share it with third parties for marketing. A public verification page is optional, and it shows first name and last initial only.'
      ],
      links: [{ href: '/privacy', label: 'Privacy Policy' }],
      video: { file: 'ask-who-sees-my-info', poster: false }
    },
    {
      id: 'apply',
      q: 'How do I apply to a job?',
      paras: [
        'You need to be fully verified: email, phone and identity. Each job lists up to three skills with a minimum level, and it can also ask for things like education, certifications, a shift or a work area.',
        'If you do not meet a requirement, the Apply button stays hidden and the job page tells you what is missing and links to the fix. When you meet them all, Apply turns on.',
        'If a job already has a full waiting list, applications pause until the recruiter clears it.'
      ],
      links: [{ href: '/jobs', label: 'Browse jobs' }],
      video: null
    },
    {
      id: 'no-hire',
      q: 'What if a recruiter doesn\'t pick me?',
      paras: [
        FEEDBACK_LINE + ' It is written as an area to work on, so you know what to improve.',
        'Recruiters also have to close out every job they post. If one passes the close date without recording an outcome, the job is closed after 14 days and every applicant still waiting is told that no one is listed as hired through PreCheckd.',
        'If the feedback you were given is not true, for example you were never interviewed, you can report it from your application.'
      ],
      links: [],
      video: null
    },
    {
      id: 'recruiters',
      q: 'I\'m a recruiter. What do I get?',
      paras: [
        'You can search candidates by verified skills and levels, post jobs, and ask a connected candidate to take a test. Candidates see that you are an identity-verified recruiter.',
        'In return, you close out every job you post, and you tell each applicant you pass on an area to work on. That is what candidates are paying to get here.'
      ],
      links: [{ href: '/recruiter-landing', label: 'For recruiters' }],
      video: null
    },
    {
      id: 'failed-test',
      q: 'What if I fail a test?',
      paras: [
        'You can retake each test once every 60 days, and the Expert exam once every 90 days. The latest published result counts. Tests draw from a question bank, so a retake will not be the same questions.',
        'You choose which skills recruiters can see.'
      ],
      links: [{ href: '/skills-explained', label: 'Skills explained' }],
      video: null
    }
  ];
}

module.exports = { getAnswers };
