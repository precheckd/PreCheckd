// The Resource center: plain-language guides for job seekers. Add a guide by adding an entry here; the hub page,
// the sitemap and the "related guides" list all read from this file.
//
// Each section is { h: heading, p: [paragraphs], ul: [bullets] } (p and ul are both optional).
// Keep claims general and checkable: no invented statistics.
const UPDATED = '2026-11-19';

const GUIDES = [
  {
    slug: 'spot-a-fake-or-ghost-job-posting',
    title: 'How to Spot a Fake or Ghost Job Posting',
    description: 'Ghost jobs and fake postings waste your time or steal your information. Here are the signs to look for and what to check before you apply.',
    summary: 'The signs of a posting that is not really open, and what to check before you spend hours applying.',
    updated: UPDATED,
    intro: 'A ghost job is a posting the company is not actively trying to fill. A fake posting is worse: it is run by someone who wants your personal information, not to hire you. Both cost you time, and neither is always easy to see. No single sign proves anything, but several together are a good reason to slow down.',
    sections: [
      {
        h: 'Why ghost jobs exist',
        p: ['Companies leave postings up for reasons that have nothing to do with a real opening: collecting resumes for later, keeping a role listed "just in case," looking busy, or forgetting to take down a job that was already filled, sometimes by someone inside the company.'],
      },
      {
        h: 'Signs a posting may not be real',
        ul: [
          'It has been up for a long time, or it keeps reappearing with a fresh date.',
          'The description is vague: no specific duties, team or tools, just buzzwords. Or it asks for far more than the level of the role, like many years of experience for an entry-level job.',
          'There is no pay range. Some states and cities require one, so a missing range is not proof, but it is one more thing to weigh.',
          'You can\'t find the job on the company\'s own careers page.',
          'There is no named recruiter or hiring manager, or the recruiter\'s profile is new and has almost no history.',
          'The same job is posted in many cities, or by several different recruiters at once.',
          'The company has recently announced layoffs or a hiring freeze.',
          'You apply and hear nothing, not even an automatic confirmation.',
        ],
      },
      {
        h: 'What to check before you apply',
        ul: [
          'Search for the job title on the company\'s own website. A real, active opening is almost always listed there.',
          'Search the company\'s name with words like "layoffs" or "hiring freeze" and read anything recent.',
          'Look at the recruiter on LinkedIn. Do they have a real history, and do they work where they say they do?',
          'If you reach a recruiter, ask directly: is this role open and funded right now, and what is the timeline? A real recruiter can answer.',
          'Don\'t spend an hour customizing an application until you have some sign that the job is live.',
        ],
      },
      {
        h: 'When it is a scam, not just a ghost',
        p: ['A ghost job wastes your time. A scam wants your money or your identity. If anything asks you for payment, a Social Security number or bank details early on, stop and read our guide to recruiter and job offer scams.'],
      },
    ],
    related: ['recruiter-and-job-offer-scam-red-flags', 'is-this-company-really-hiring'],
  },
  {
    slug: 'recruiter-and-job-offer-scam-red-flags',
    title: 'Fake Recruiter and Job Offer Scams: Red Flags to Watch For',
    description: 'The most common fake recruiter and job offer scams, the warning signs, and what to do if you have shared money or personal details.',
    summary: 'The warning signs of a fake recruiter or job offer, and what to do if you have already shared information.',
    updated: UPDATED,
    intro: 'Job scams work because they arrive when you are hoping for good news. The messages can look professional, use a real company\'s name and even copy a real recruiter\'s photo. The patterns below show up again and again.',
    sections: [
      {
        h: 'Common scams',
        ul: [
          '**Pay-to-work scams.** You are asked to pay for equipment, training, software or a background check before you start.',
          '**Fake check scams.** You are sent a check and told to deposit it and send part back, or buy equipment from a specific vendor. The check later bounces and you owe the bank.',
          '**Chat-only interviews.** The whole "interview" happens in a messaging app such as Telegram or WhatsApp, with no call or video, and ends in an instant offer.',
          '**Identity harvesting.** The "onboarding" asks for your Social Security number, bank details or a photo of your ID before any real hiring step.',
          '**Impersonation.** Someone pretends to be a real recruiter or a real company. The name is genuine, but the email address and the person are not.',
          '**Task and payment scams.** A "job" asking you to handle payments, move money, reship packages or complete paid tasks that need an upfront deposit.',
        ],
      },
      {
        h: 'Red flags in the message',
        ul: [
          'They contact you first about a job you never applied for, and it sounds too good for the work involved.',
          'The email comes from a free address such as Gmail, or from a domain that is almost the company\'s name but not quite.',
          'The email domain was only registered recently.',
          'You are hired within a day or two with little or no real interview.',
          'There is pressure and secrecy: "reply today," "don\'t tell anyone."',
          'Typos, odd wording, or details that don\'t match the company\'s real job listing.',
        ],
      },
      {
        h: 'How to check the sender',
        p: ['Paste the sender\'s email address into our <a href="/is-this-recruiter-real">recruiter email checker</a> to see how old the domain is and whether the address belongs to a verified PreCheckd recruiter. Then find the company\'s website yourself, look for the job on its careers page, and use a phone number from that site, not from the message, to confirm the recruiter works there.'],
      },
      {
        h: 'If you have already shared something',
        ul: [
          'Stop replying, and don\'t click any more links or open attachments.',
          'If you sent money or bank details, contact your bank or card company right away.',
          'If you shared your Social Security number or ID, consider placing a fraud alert or a credit freeze with the credit bureaus.',
          'If you clicked a link or installed something, change the passwords for your email and any important accounts, starting with email.',
          'Report it to the FTC at <a href="https://reportfraud.ftc.gov" target="_blank" rel="noopener noreferrer">reportfraud.ftc.gov</a> and to the FBI\'s Internet Crime Complaint Center at <a href="https://www.ic3.gov" target="_blank" rel="noopener noreferrer">ic3.gov</a>, and report the account to the site where you found it.',
          'You can also <a href="/fraud">report the sender to PreCheckd</a>.',
        ],
      },
    ],
    related: ['how-to-verify-a-job-offer', 'spot-a-fake-or-ghost-job-posting'],
  },
  {
    slug: 'how-to-verify-a-job-offer',
    title: 'How to Verify a Job Offer Is Real Before You Accept',
    description: 'A step-by-step checklist to confirm a job offer and the recruiter behind it are real, before you share personal details or sign anything.',
    summary: 'A checklist to confirm an offer and the person behind it are real before you share anything sensitive.',
    updated: UPDATED,
    intro: 'A real offer survives a few minutes of checking. A scam usually doesn\'t, which is why a polite request to verify is one of the best tests you have. Work through these steps before you share sensitive details, buy anything or sign.',
    sections: [
      {
        h: 'The checklist',
        ul: [
          '**Check the email address.** Does the domain match the company\'s real website? Is it a free address? Use our <a href="/is-this-recruiter-real">email checker</a> for the domain\'s age.',
          '**Find the job on the company\'s own website.** Go to the site yourself instead of using a link in the message.',
          '**Confirm the recruiter exists.** Look for them on LinkedIn and on the company\'s team or careers pages. See if their history makes sense.',
          '**Call the company.** Use the main number from its official website, not one from the message, and ask whether this recruiter and this role are real.',
          '**Insist on a real conversation.** A phone or video call with a person is normal for a real hiring process. A refusal to talk is a warning sign.',
          '**Read the offer letter closely.** It should name the company\'s correct legal name, the role, the pay, the start date and who you report to. Be wary of vague wording or a mismatch with the job posting.',
        ],
      },
      {
        h: 'What a real employer will and won\'t ask for',
        p: ['A real employer will eventually need details like your Social Security number and bank account for payroll and tax forms. That happens after you have accepted a verified offer, through the company\'s HR or payroll system, not by email or chat during the first conversations. A real employer will never ask you to pay for the job, send money back from a check, or buy equipment from a vendor they name.'],
      },
      {
        h: 'If something feels off',
        ul: [
          'Slow down. A genuine offer will still be there after you have checked.',
          'Ask the question out loud: "Can I verify this by calling the company\'s main number?" Real recruiters say yes.',
          'Trust the pattern. If several things on this list don\'t add up, walk away.',
        ],
      },
    ],
    related: ['recruiter-and-job-offer-scam-red-flags', 'is-this-company-really-hiring'],
  },
  {
    slug: 'is-this-company-really-hiring',
    title: 'Is This Company Really Hiring? How to Tell',
    description: 'How to tell whether a company has a real, funded opening or is just keeping a posting up, and the questions to ask a recruiter.',
    summary: 'How to tell if an opening is real and funded, and the questions that get honest answers from a recruiter.',
    updated: UPDATED,
    intro: 'Even honest companies post jobs they are slow to fill, or never plan to fill soon. You can often tell the difference with a few minutes of research and a few direct questions.',
    sections: [
      {
        h: 'Signs the opening is real',
        ul: [
          'The job is listed on the company\'s own careers page, with a recent date.',
          'The description names the team, the duties and the tools, and the requirements are in line with the level.',
          'A named recruiter or hiring manager responds, and their profile has a real history.',
          'You get an automatic confirmation or a reply in a reasonable time, and a clear next step.',
          'The company has recent, positive hiring signs, such as new funding, growth announcements or employees posting that the team is growing.',
        ],
      },
      {
        h: 'Signs it may not be',
        ul: [
          'The posting is old, or keeps being reposted with no sign of the role being filled.',
          'Recent news about layoffs, a hiring freeze or restructuring.',
          'No response at all, not even an automated one.',
          'Interviews that drag on with no clear timeline or decision-maker.',
        ],
      },
      {
        h: 'Questions to ask the recruiter',
        ul: [
          'Is this role open and funded right now?',
          'Who would I report to, and is that person involved in the hiring?',
          'What does the process look like, and how long does it usually take?',
          'Why is the role open? Is it a new position or a replacement?',
          'How many people are you interviewing at this stage?',
        ],
        p: ['Real recruiters can answer these. Vague or evasive answers tell you something too.'],
      },
      {
        h: 'Protect your time',
        p: ['Until you have a sign that a job is live, use a quick application rather than a heavily customized one. Keep a simple list of what you applied for, when, and who replied, so you can follow up on the live ones and move on from the rest.'],
      },
    ],
    related: ['spot-a-fake-or-ghost-job-posting', 'how-to-verify-a-job-offer'],
  },
];

// Pages that are not guides but belong in the Resource center.
const EXTRAS = [
  { href: '/is-this-recruiter-real', title: 'Is this recruiter real?', summary: 'Check a recruiter\'s email address: how old the domain is and whether they are verified on PreCheckd.' },
  { href: '/skills-explained', title: 'How skill levels work', summary: 'How PreCheckd skill tests work, from Foundational to Grandmaster, and what recruiters see.' },
];

const bySlug = (slug) => GUIDES.find((g) => g.slug === slug) || null;
const pathFor = (g) => '/resources/' + g.slug;

module.exports = { GUIDES, EXTRAS, bySlug, pathFor, UPDATED };
