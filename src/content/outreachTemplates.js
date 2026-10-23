// Recruiter outreach templates (roadmap #4). Recruiters pick a template and add
// a short note; they do not write free-form subjects, which keeps outreach
// recognizable and hard to dress up as something else. {role} is the only
// recruiter-supplied word in a subject. The company always comes from the
// recruiter's verified account, never from a form.
const TEMPLATES = {
  role: {
    label: 'A specific role',
    needsRole: true,
    subject: ({ recruiter, role }) => `${recruiter} is hiring: ${role}`,
    intro: ({ first, recruiter, company, role }) =>
      `Hi ${first},\n\nI'm ${recruiter}${company ? ` at ${company}` : ''}. I'm hiring for a ${role} and thought your background could be a fit.`
  },
  // Used only from a recruiter's own open posting (routes/recruiter-jobs.js supplies the link); never offered on the
  // general compose form.
  job: {
    label: 'A job posted on PreCheckd',
    needsRole: true,
    needsJob: true,
    subject: ({ recruiter, role }) => `${recruiter} is hiring: ${role}`,
    intro: ({ first, recruiter, company, role, jobUrl }) =>
      `Hi ${first},\n\nI'm ${recruiter}${company ? ` at ${company}` : ''}. I'm hiring for a ${role} and posted it on PreCheckd: ${jobUrl}\n\nOnly verified candidates who meet every requirement can apply, so you will see right away whether it fits.`
  },
  intro: {
    label: 'A short introduction',
    needsRole: false,
    subject: ({ recruiter }) => `${recruiter}, a verified recruiter, would like to connect`,
    intro: ({ first, recruiter, company }) =>
      `Hi ${first},\n\nI'm ${recruiter}${company ? ` at ${company}` : ''}. I'd like to introduce myself and hear what kind of roles you're open to.`
  }
};

module.exports = { TEMPLATES };
