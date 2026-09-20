(function () {
  const data = window.PRECHECKD_CANDIDATE_DATA || { workHistory: [], educationHistory: [], certifications: [] };

  let workEntryCount = 0;
  let educationEntryCount = 0;
  let certificationEntryCount = 0;

  function statusBadgeHtml(verified) {
    return verified
      ? '<span class="entry-badge badge-verified">✓ Verified</span>'
      : '<span class="entry-badge badge-pending">Verification Pending</span>';
  }

  function addWorkEntry(entry) {
    const container = document.getElementById('work-entries');
    const index = workEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.workIndex = index;
    div.dataset.verified = entry?.verified ? 'true' : 'false';
    div.dataset.verifiedAt = entry?.verifiedAt || '';

    div.innerHTML = `
      <div class="entry-top">
        ${statusBadgeHtml(entry?.verified)}
        <button type="button" class="remove-entry">Remove</button>
      </div>
      <label>Job title<input type="text" class="work-title" value="${entry?.jobTitle || ''}" placeholder="e.g. Software Engineer"></label>
      <label>Employer<input type="text" class="work-employer" value="${entry?.employerName || ''}" placeholder="e.g. Acme Corp"></label>
      <label>Start date <span class="label-hint">(YYYY-MM)</span><input type="text" class="work-start" value="${entry?.startDate || ''}" placeholder="2022-03"></label>
      <label>End date <span class="label-hint">(YYYY-MM, or leave blank if current)</span><input type="text" class="work-end" value="${entry?.endDate || ''}" placeholder="2024-06"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function addEducationEntry(entry) {
    const container = document.getElementById('education-entries');
    const index = educationEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.educationIndex = index;

    div.innerHTML = `
      <div class="entry-top">
        ${statusBadgeHtml(entry?.verified)}
        <button type="button" class="remove-entry">Remove</button>
      </div>
      <label>School<input type="text" class="edu-school" value="${entry?.schoolName || ''}" placeholder="e.g. State University"></label>
      <label>Degree<input type="text" class="edu-degree" value="${entry?.degree || ''}" placeholder="e.g. BS Computer Science"></label>
      <label>Graduation date <span class="label-hint">(YYYY-MM)</span><input type="text" class="edu-date" value="${entry?.graduationDate || ''}" placeholder="2020-05"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function addCertificationEntry(entry) {
    const container = document.getElementById('certification-entries');
    const index = certificationEntryCount++;
    const div = document.createElement('div');
    div.className = 'entry-card';
    div.dataset.certIndex = index;

    div.innerHTML = `
      <div class="entry-top">
        ${statusBadgeHtml(entry?.verified)}
        <button type="button" class="remove-entry">Remove</button>
      </div>
      <label>Certification name<input type="text" class="cert-name" value="${entry?.name || ''}" placeholder="e.g. AWS Certified Cloud Practitioner"></label>
      <label>Credential ID <span class="label-hint">(optional)</span><input type="text" class="cert-credential-id" value="${entry?.credentialId || ''}" placeholder="e.g. AWS-1234ABCD"></label>
    `;
    div.querySelector('.remove-entry').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  // Pre-populate with existing saved data
  (data.workHistory || []).forEach((entry) => addWorkEntry(entry));
  (data.educationHistory || []).forEach((entry) => addEducationEntry(entry));
  (data.certifications || []).forEach((entry) => addCertificationEntry(entry));

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

  // Since these arrays don't map cleanly onto simple form field names,
  // build hidden inputs holding JSON just before submit so the server
  // receives them as regular parsed fields.
  const form = document.getElementById('edit-form');
  const saveButton = document.getElementById('save-button');

  form.addEventListener('submit', () => {
    const resumeInput = form.querySelector('input[name="resume"]');
    if (resumeInput && resumeInput.files.length > 0) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving and processing resume...';
    }
    const addHiddenJsonField = (name, value) => {
      const existing = form.querySelector(`input[name="${name}"]`);
      if (existing) existing.remove();
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = JSON.stringify(value);
      form.appendChild(input);
    };

    addHiddenJsonField('workHistory', collectWorkEntries());
    addHiddenJsonField('educationHistory', collectEducationEntries());
    addHiddenJsonField('certifications', collectCertificationEntries());
  });
})();