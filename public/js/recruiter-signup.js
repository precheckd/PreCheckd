// Recruiter Signup Flow

let currentStep = 1;
let phoneNumber = '';

// Step 1: Form Submission
const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const company = document.getElementById('company').value;

    if (!firstName || !lastName || !email || !phone) {
      alert('Please fill in all required fields');
      return;
    }

    phoneNumber = phone;

    try {
      const response = await fetch('/api/founding-recruiter/signup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({firstName, lastName, email, phone, company})
      });

      const result = await response.json();

      if (result.success) {
        currentStep = 2;
        document.getElementById('step-signup').classList.remove('active');
        document.getElementById('step-phone').classList.add('active');
        updateProgressBar(67);
      } else {
        alert(result.error || 'Signup failed');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred');
    }
  });
}

// Phone Verification Form
const phoneForm = document.getElementById('phone-form');
if (phoneForm) {
  phoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const code = document.getElementById('code').value;

    if (!code) {
      alert('Please enter the verification code');
      return;
    }

    try {
      const response = await fetch('/api/founding-recruiter/verify-phone', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code})
      });

      const result = await response.json();

      if (result.success) {
        currentStep = 3;
        document.getElementById('step-phone').classList.remove('active');
        document.getElementById('step-payment').classList.add('active');
        updateProgressBar(100);
      } else {
        alert(result.message || 'Invalid code');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred');
    }
  });
}

// Resend Code Button
const resendBtn = document.getElementById('resend-btn');
if (resendBtn) {
  resendBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/founding-recruiter/resend-code', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
      });
      const result = await response.json();
      alert(result.success ? result.message : (result.error || 'Failed'));
    } catch (error) {
      alert('An error occurred');
    }
  });
}

// Complete Verification Button
const verifyBtn = document.getElementById('verify-button');
if (verifyBtn) {
  verifyBtn.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/founding-recruiter/create-identity-session', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
      });
      const result = await response.json();
      if (result.success) {
        alert('Profile verified!');
        window.location.href = '/recruiter/' + result.recruiter.id;
      } else {
        alert(result.error || 'Verification failed');
      }
    } catch (error) {
      alert('An error occurred');
    }
  });
}

function updateProgressBar(percentage) {
  const bar = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');
  const percent = document.getElementById('progress-percent');
  
  if (bar) bar.style.width = percentage + '%';
  if (percent) percent.textContent = percentage + '%';
  if (text) {
    if (percentage === 33) text.textContent = 'Step 1 of 3';
    else if (percentage === 67) text.textContent = 'Step 2 of 3';
    else if (percentage === 100) text.textContent = 'Step 3 of 3';
  }
}