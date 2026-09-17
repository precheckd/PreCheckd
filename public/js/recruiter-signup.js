(function () {
  const errorEl = document.getElementById('form-error');
  const recruiterContext = window.PRECHECKD_RECRUITER; // { slug, name } or null

  let stripe = null;
  let stripeClientSecret = null;
  let stripeSessionId = null;
  let isMockIdentity = false;
  let candidateSlug = null;
  let workEntryCount = 0;
  let educationEntryCount = 0;
  let certificationEntryCount = 0;

  function showStep(id) {
    document.querySelectorAll('.form-step').forEach((el) => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');

    const headerText = document.getElementById('page-header-text');
    if (id === 'step-done' || id === 'step-connect-done') {
      headerText.classList.add('hidden');
    } else {
      headerText.classList.remove('hidden');
    }
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function hideError() {
    errorEl.classList.add('hidden');
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data.error || (data.errors && data.errors[0].msg)) || 'Something went wrong');
    }
    return data;
  }

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong');
    }
    return data;
  }

  function initStripe() {
    if (!stripe) {
      stripe = Stripe(document.body.dataset.stripeKey);
    }
  }

  function proceedAfterReview() {
    if (recruiterContext) {
      document.getElementById('connect-recruiter-name').textContent = recruiterContext.name;
      showStep('step-connect-confirm');
    } else {
      document.getElementById('view-profile-link').href = `/candidate/${candidateSlug}`;
      showStep('step-done');
    }
  }

  // --- Dynamic work/education/certification entry cards ---

  function addWorkEntry(data) {
    const container = document.getElementById('work-entries');
    const index = workEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.workIndex = index;
    div.innerHTML = `
      <button type="button" class="remove-entry">Remove</button>
      <label>Job title<input type="text" class="work-title" value="${data?.jobTitle || ''}" placeholder="e.g. Software Engineer"></label>
      <label>Employer<input type="text" class="work-employer" value="${data?.employerName || ''}" placeholder="e.g. Acme Corp"></label>
      <label>Start date <span class="label-hint">(YYYY-MM)</span><input type="text" class="work-start" value="${data?.startDate || ''}" placeholder="2022-03"></label>
      <label>End date <span class="label-hint">(YYYY-MM, or leave blank if current)</span><input type="text" class="work-end" value="${data?.endDate || ''}" placeholder="2024-06"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function addEducationEntry(data) {
    const container = document.getElementById('education-entries');
    const index = educationEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.educationIndex = index;
    div.innerHTML = `
      <button type="button" class="remove-entry">Remove</button>
      <label>School<input type="text" class="edu-school" value="${data?.schoolName || ''}" placeholder="e.g. State University"></label>
      <label>Degree<input type="text" class="edu-degree" value="${data?.degree || ''}" placeholder="e.g. BS Computer Science"></label>
      <label>Graduation date <span class="label-hint">(YYYY-MM)</span><input type="text" class="edu-date" value="${data?.graduationDate || ''}" placeholder="2020-05"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function addCertificationEntry(data) {
    const container = document.getElementById('certification-entries');
    const index = certificationEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.certIndex = index;
    div.innerHTML = `
      <button type="button" class="remove-entry">Remove</button>
      <label>Certification name<input type="text" class="cert-name" value="${data?.name || ''}" placeholder="e.g. AWS Certified Cloud Practitioner"></label>
      <label>Credential ID <span class="label-hint">(optional)</span><input type="text" class="cert-credential-id" value="${data?.credentialId || ''}" placeholder="e.g. AWS-1234ABCD"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  document.getElementById('add-work-entry').addEventListener('click', () => addWorkEntry());
  document.getElementById('add-education-entry').addEventListener('click', () => addEducationEntry());
  document.getElementById('add-certification-entry').addEventListener('click', () => addCertificationEntry());

  function collectWorkEntries() {
    return Array.from(document.querySelectorAll('#work-entries .entry-card')).map((card) => ({
      jobTitle: card.querySelector('.work-title').value.trim(),
      employerName: card.querySelector('.work-employer').value.trim(),
      startDate: card.querySelector('.work-start').value.trim(),
      endDate: card.querySelector('.work-end').value.trim() || null,
    })).filter((entry) => entry.jobTitle && entry.employerName && entry.startDate);
  }

  function collectEducationEntries() {
    return Array.from(document.querySelectorAll('#education-entries .entry-card')).map((card) => ({
      schoolName: card.querySelector('.edu-school').value.trim(),
      degree: card.querySelector('.edu-degree').value.trim(),
      graduationDate: card.querySelector('.edu-date').value.trim(),
    })).filter((entry) => entry.schoolName && entry.degree && entry.graduationDate);
  }

  function collectCertificationEntries() {
    return Array.from(document.querySelectorAll('#certification-entries .entry-card')).map((card) => ({
      name: card.querySelector('.cert-name').value.trim(),
      credentialId: card.querySelector('.cert-credential-id').value.trim() || null,
    })).filter((entry) => entry.name);
  }

  // --- Poll resume parsing status, then show the review screen ---

  async function waitForResumeAndShowReview(hasResume) {
    if (!hasResume) {
      document.getElementById('review-intro-text').textContent =
        'Add your work history, education, and certifications — you can always come back and update this later.';
      showStep('step-review');
      return;
    }

    showStep('step-parsing-wait');

    const maxAttempts = 10;
    const delayMs = 1500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await getJson('/api/candidate/resume-status');

        if (result.status === 'complete') {
          document.getElementById('review-bio').value = result.bio || '';
          (result.workHistory || []).forEach((entry) => addWorkEntry(entry));
          (result.educationHistory || []).forEach((entry) => addEducationEntry(entry));
          (result.certifications || []).forEach((entry) => addCertificationEntry(entry));
          document.getElementById('review-intro-text').textContent =
            "Here's what we found on your resume — take a look and make any changes before continuing.";
          showStep('step-review');
          return;
        }

        if (result.status === 'failed') {
          document.getElementById('review-intro-text').textContent =
            "We couldn't read your resume automatically — no problem, just add your details below.";
          showStep('step-review');
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (err) {
        break;
      }
    }

    document.getElementById('review-intro-text').textContent =
      "Still working on your resume in the background — feel free to add your details below in the meantime.";
    showStep('step-review');
  }

  // --- Step 0: Email gate ---
  const emailGateForm = document.getElementById('email-gate-form');
  emailGateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const email = new FormData(emailGateForm).get('email');

    try {
      const result = await postJson('/api/candidate/check-email', {
        email,
        recruiterSlug: recruiterContext ? recruiterContext.slug : null
      });

      if (result.exists) {
        showStep('step-login-code');
      } else {
        document.getElementById('signup-email-hidden').value = email;
        showStep('step-signup');
      }
    } catch (err) {
      showError(err.message);
    }
  });

  // --- Returning candidate: login code ---
  const loginCodeForm = document.getElementById('login-code-form');
  loginCodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    try {
      const code = new FormData(loginCodeForm).get('code');
      const result = await postJson('/api/candidate/login-verify', { code });
      candidateSlug = result.slug;

      if (result.isFullyVerified) {
        proceedAfterReview();
      } else {
        showStep('step-identity');
        await prepareIdentitySession();
      }
    } catch (err) {
      showError(err.message);
    }
  });

  // --- New candidate: signup details + resume upload ---
  const signupForm = document.getElementById('candidate-signup-form');
  let signupHadResume = false;

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const formData = new FormData(signupForm);
    const resumeFile = formData.get('resume');
    signupHadResume = Boolean(resumeFile && resumeFile.size > 0);

    try {
      const res = await fetch('/api/candidate/signup', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong');
      }
      showStep('step-phone');
    } catch (err) {
      showError(err.message);
    }
  });

  // --- New candidate: phone code ---
  const phoneForm = document.getElementById('candidate-phone-form');
  phoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    try {
      const code = new FormData(phoneForm).get('code');
      await postJson('/api/candidate/verify-phone', { code });
      showStep('step-identity');
      await prepareIdentitySession();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- Identity verification ---
  async function prepareIdentitySession() {
    try {
      const sessionResponse = await postJson('/api/candidate/create-identity-session', {});
      isMockIdentity = Boolean(sessionResponse.mock);
      stripeSessionId = sessionResponse.sessionId;
      stripeClientSecret = sessionResponse.clientSecret;

      if (isMockIdentity) {
        const identitySection = document.getElementById('step-identity');
        identitySection.querySelector('p').textContent =
          '[TEST MODE] Identity verification is mocked. Click below to continue.';
        document.getElementById('stripe-element').classList.add('hidden');
      } else {
        initStripe();
      }
    } catch (err) {
      showError(err.message);
    }
  }

  const identityButton = document.getElementById('identity-button');
  identityButton.addEventListener('click', async () => {
    hideError();
    identityButton.disabled = true;
    identityButton.textContent = 'Verifying...';

    if (isMockIdentity) {
      try {
        const response = await postJson('/api/candidate/verify-identity-session', {
          sessionId: stripeSessionId,
        });
        identityButton.disabled = false;
        identityButton.textContent = 'Complete verification';

        if (response.success) {
          candidateSlug = response.slug;
          await waitForResumeAndShowReview(signupHadResume);
        } else {
          showError(response.message || 'Something went wrong.');
        }
      } catch (err) {
        identityButton.disabled = false;
        identityButton.textContent = 'Complete verification';
        showError(err.message);
      }
      return;
    }

    if (!stripeClientSecret) {
      showError('Verification session not ready. Please refresh and try again.');
      identityButton.disabled = false;
      identityButton.textContent = 'Complete verification';
      return;
    }

    identityButton.textContent = 'Opening verification...';

    try {
      const result = await stripe.verifyIdentity(stripeClientSecret);

      identityButton.disabled = false;
      identityButton.textContent = 'Complete verification';

      if (result.error) {
        showError(result.error.message || 'Verification was not completed.');
        return;
      }

      const response = await postJson('/api/candidate/verify-identity-session', {
        sessionId: stripeSessionId,
      });

      if (response.success) {
        candidateSlug = response.slug;
        await waitForResumeAndShowReview(signupHadResume);
      } else {
        showError(response.message || 'Verification is still processing. Please check back shortly.');
      }
    } catch (err) {
      identityButton.disabled = false;
      identityButton.textContent = 'Complete verification';
      showError(err.message || 'An error occurred during verification');
    }
  });

  // --- Review/save profile details ---
  const reviewForm = document.getElementById('review-form');
  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const bio = document.getElementById('review-bio').value;
    const workHistory = collectWorkEntries();
    const educationHistory = collectEducationEntries();
    const certifications = collectCertificationEntries();

    try {
      await postJson('/api/candidate/save-profile-details', { bio, workHistory, educationHistory, certifications });
      proceedAfterReview();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- Connect confirmation ---
  const connectForm = document.getElementById('connect-confirm-form');
  const connectButton = document.getElementById('connect-confirm-button');

  if (connectForm) {
    connectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      connectButton.disabled = true;
      connectButton.textContent = 'Sending...';

      const note = new FormData(connectForm).get('note');

      try {
        const result = await postJson('/api/candidate/connect', { note });
        document.getElementById('connect-done-title').textContent = result.alreadySent
          ? 'Already sent'
          : 'Request sent!';
        document.getElementById('connect-done-text').textContent = result.alreadySent
          ? `You've already sent a connection request to ${result.recruiterName}.`
          : `${result.recruiterName} will be notified and can choose to share their contact info with you.`;
        showStep('step-connect-done');
      } catch (err) {
        connectButton.disabled = false;
        connectButton.textContent = 'Send Connection Request';
        showError(err.message);
      }
    });
  }
})();