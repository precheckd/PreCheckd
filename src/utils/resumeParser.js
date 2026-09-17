const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

async function extractTextFromFile(file) {
  const mimeType = file.mimetype;

  if (mimeType === 'application/pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
}

async function extractStructuredDataFromText(resumeText) {
  const prompt = `You are extracting structured data from a resume. Return ONLY valid JSON, no other text, no markdown code fences.

Extract the following from the resume text below:
- "bio": A short professional summary/objective statement if one exists at the top of the resume (2-4 sentences max). If none exists, use null.
- "workHistory": An array of jobs, each with "employerName", "jobTitle", "startDate" (format "YYYY-MM"), "endDate" (format "YYYY-MM", or null if current/present).
- "educationHistory": An array of education entries, each with "schoolName", "degree", "graduationDate" (format "YYYY-MM").

If a date only has a year (no month), use "01" as the month. If you cannot confidently determine a field, use null for that field rather than guessing.

Resume text:
---
${resumeText}
---

Return only the JSON object with keys "bio", "workHistory", "educationHistory". No other text.`;

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text || '';

  let parsed;
  try {
    const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    console.error('Failed to parse Claude response as JSON:', rawText);
    throw new Error('Could not understand the resume format. Please enter your information manually.');
  }

  return {
    bio: parsed.bio || null,
    workHistory: Array.isArray(parsed.workHistory) ? parsed.workHistory : [],
    educationHistory: Array.isArray(parsed.educationHistory) ? parsed.educationHistory : [],
  };
}

async function parseResume(file) {
  const text = await extractTextFromFile(file);

  if (!text || text.trim().length < 50) {
    throw new Error('Could not extract readable text from this file. Please enter your information manually.');
  }

  return extractStructuredDataFromText(text);
}

module.exports = { parseResume };