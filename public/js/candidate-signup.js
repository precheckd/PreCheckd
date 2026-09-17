(function () {
  const errorEl = document.getElementById('form-error');
  const recruiterContext = window.PRECHECKD_RECRUITER; // { slug, name } or null

  let stripe = null;
  let stripeClientSecret = null;
  let stripeSessionId = null;
  let candidateSlug = null;

  function showStep(id) {
    document.querySelectorAll('.form-step').forEach((el) => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
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

  function initStripe() {
    if (!stripe) {
      stripe = Stripe(document.body.dataset.stripeKey);
    }
  }

  // After Identity verification succeeds, either show the connect-confirm
  // step (if a recruiter is in context) or the generic "you're verified" screen.
  function proceedAfterIdentity() {
    if (recruiterContext) {
      document.getElementById('connect-recruiter-name').textContent = recruiterContext.name;
      showStep('step-connect-confirm');
    } else {
      document.getElementById('view-profile-link').href = `/candidate/${candidateSlug}`;
      showStep('step-done');
    }
  }

  async function prepareIdentitySession() {
    try {
      initStripe();
      const sessionResponse = await postJson('/api/candidate/create-identity-session', {});
      stripeSessionId = sessionResponse.sessionId;
      stripeClientSecret = sessionResponse.clientSecret;
    } catch (err) {
      showError(err.message);
    }
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
        proceedAfterIdentity();
      } else {
        showStep('step-identity');
        await prepareIdentitySession();
      }
    } catch (err) {
      showError(err.message);
    }
  });

  // --- New candidate: signup details ---
  const signupForm = document.getElementById('candidate-signup-form');
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const formData = Object.fromEntries(new FormData(signupForm).entries());

    try {
      await postJson('/api/candidate/signup', formData);
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
      showStep('step-email-code');
    } catch (err) {
      showError(err.message);
    }
  });

  // --- New candidate: email code ---
  const emailCodeForm = document.getElementById('candidate-email-code-form');
  emailCodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    try {
      const code = new FormData(emailCodeForm).get('code');
      await postJson('/api/candidate/verify-email-code', { code });
      showStep('step-identity');
      await prepareIdentitySession();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- Identity verification ---
  const identityButton = document.getElementById('identity-button');
  identityButton.addEventListener('click', async () => {
    if (!stripeClientSecret) {
      showError('Verification session not ready. Please refresh and try again.');
      return;
    }

    hideError();
    identityButton.disabled = true;
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
        proceedAfterIdentity();
      } else {
        showError(response.message || 'Verification is still processing. Please check back shortly.');
      }
    } catch (err) {
      identityButton.disabled = false;
      identityButton.textContent = 'Complete verification';
      showError(err.message || 'An error occurred during verification');
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