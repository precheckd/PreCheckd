// Recruiter Signup Flow

let currentStep = 1;
let phoneNumber = '';

// Step 1: Form Submission
const form = document.getElementById('recruiter-form');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.querySelector('input[name="firstName"]').value;
    const lastName = document.querySelector('input[name="lastName"]').value;
    const email = document.querySelector('input[name="email"]').value;
    const phone = document.querySelector('input[name="phone"]').value;
    const company = document.querySelector('input[name="company"]').value;

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
        document.querySelector('.step-1').style.display = 'none';
        document.querySelector('.step-2').style.display = 'block';
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

// Verify Code Button
const verifyBtn = document.getElementById('verify-code-btn');
if (verifyBtn) {
  verifyBtn.addEventListener('click', async () => {
    const code = document.querySelector('input[name="verificationCode"]').value;

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
        document.querySelector('.step-2').style.display = 'none';
        document.querySelector('.step-3').style.display = 'block';
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

// Resend Code
const resendBtn = document.getElementById('resend-code-btn');
if (resendBtn) {
  resendBtn.addEventListener('click', async () => {
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

// Complete Verification
const completeBtn = document.getElementById('complete-verification-btn');
if (completeBtn) {
  completeBtn.addEventListener('click', async () => {
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
  const bar = document.querySelector('.progress-bar');
  if (bar) bar.style.width = percentage + '%';
}