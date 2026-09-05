const steps = ['step-signup', 'step-phone', 'step-payment'];
let currentStep = 0;

function updateProgress() {
  const percent = Math.round(((currentStep + 1) / steps.length) * 100);
  document.getElementById('progress-text').textContent = `Step ${currentStep + 1} of ${steps.length}`;
  document.getElementById('progress-percent').textContent = `${percent}%`;
  document.getElementById('progress-fill').style.width = `${percent}%`;
}

function showStep(index) {
  steps.forEach((step, i) => {
    const el = document.getElementById(step);
    el.classList.toggle('active', i === index);
  });
  currentStep = index;
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function phoneToE164(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `+1${digits}`;
}

document.getElementById('phone').addEventListener('input', (e) => {
  e.target.value = formatPhoneNumber(e.target.value);
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phoneInput = document.getElementById('phone').value;
  const phone = phoneToE164(phoneInput);
  
  if (!phone) {
    document.getElementById('form-error').textContent = 'Phone number must be 10 digits';
    document.getElementById('form-error').classList.add('visible');
    return;
  }
  
  const data = {
    firstName: document.getElementById('firstName').value,
    lastName: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phone: phone,
    company: document.getElementById('company').value
  };
  
  try {
    const response = await fetch('/api/founding-recruiter/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      showStep(1);
    } else {
      const result = await response.json();
      document.getElementById('form-error').textContent = result.message || 'Error during signup';
      document.getElementById('form-error').classList.add('visible');
    }
  } catch (err) {
    document.getElementById('form-error').textContent = 'Network error. Please try again.';
    document.getElementById('form-error').classList.add('visible');
  }
});

document.getElementById('phone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('code').value;
  
  try {
    const response = await fetch('/api/founding-recruiter/verify-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (response.ok) {
      showStep(2);
    } else {
      const data = await response.json();
      document.getElementById('form-error').textContent = data.message || 'Verification failed';
      document.getElementById('form-error').classList.add('visible');
    }
  } catch (err) {
    document.getElementById('form-error').textContent = 'Network error. Please try again.';
    document.getElementById('form-error').classList.add('visible');
  }
});

document.getElementById('verify-button').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>Processing verification...';
  
  try {
    const response = await fetch('/api/founding-recruiter/create-identity-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      document.getElementById('stripe-identity-container').style.display = 'none';
      document.getElementById('verification-complete').style.display = 'block';
      
      setTimeout(() => {
        window.location.href = '/founding-recruiter-landing';
      }, 2000);
    } else {
      const error = await response.json();
      document.getElementById('form-error').textContent = error.message || 'Verification failed';
      document.getElementById('form-error').classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Start Verification';
    }
  } catch (err) {
    document.getElementById('form-error').textContent = 'Network error. Please try again.';
    document.getElementById('form-error').classList.add('visible');
    btn.disabled = false;
    btn.innerHTML = 'Start Verification';
  }
});

document.getElementById('resend-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  
  try {
    const response = await fetch('/api/founding-recruiter/resend-code', {
      method: 'POST'
    });
    if (response.ok) {
      btn.textContent = 'Code sent!';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Send again';
      }, 3000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send again';
  }
});

updateProgress();