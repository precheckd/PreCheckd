// Safety checks for in-app messages. Everything said between a recruiter and
// a candidate passes through the server, so we can stop the worst requests
// (and flag the common scam patterns) before they reach the other person.
//
// Two tiers:
//   - checkOutgoing(body): a HARD block on things that are almost never
//     innocent in a chat — Social Security numbers, payment card numbers and
//     bank account/routing details. The message is not sent or stored.
//   - warningsFor(body): a SOFT warning shown to the RECIPIENT under a message
//     that matches a classic scam pattern (payments, moving off-platform,
//     asking for IDs/codes). The message is delivered normally.
//
// Rules are deliberately simple pattern checks: they reduce risk, they don't
// eliminate it, and the block list is kept narrow to avoid false positives.

const BLOCK_MESSAGE =
  "For your safety, PreCheckd doesn't allow Social Security numbers, payment card numbers or bank account details in messages. " +
  'A real employer only needs these after a formal offer, through an official secure process — never in chat.';

// Dashed/spaced SSN, e.g. 123-45-6789 or 123 45 6789. Rejects the ranges the
// SSA never issues (000, 666, 9xx area; 00 group; 0000 serial) so ordinary
// number sequences are less likely to trip it.
const SSN_FORMATTED = /(?<!\d)(\d{3})[- ](\d{2})[- ](\d{4})(?!\d)/g;

function isPlausibleSsn(area, group, serial) {
  if (area === '000' || area === '666' || area[0] === '9') return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

// Nine digits in a row only count when a Social Security cue sits next to it.
const SSN_CUE = /(ssn|social\s*security|social\s*sec|\bsocial\b)/i;
const NINE_DIGITS = /(?<!\d)\d{9}(?!\d)/g;

// Card numbers: 13-19 digits (spaces/dashes allowed between), Luhn-valid.
const CARD_CANDIDATE = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;

function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// "routing number 021000021", "account number: 12345678901"
const BANK_CUE_THEN_DIGITS = /(routing|aba|account)\s*(?:number|no\.?|#|num)?\s*(?:is|:|-)?\s*(?:\d[ -]?){6,}/i;

function hasFormattedSsn(text) {
  SSN_FORMATTED.lastIndex = 0;
  let match = SSN_FORMATTED.exec(text);
  while (match) {
    if (isPlausibleSsn(match[1], match[2], match[3])) return true;
    match = SSN_FORMATTED.exec(text);
  }
  return false;
}

function hasCueSsn(text) {
  NINE_DIGITS.lastIndex = 0;
  let match = NINE_DIGITS.exec(text);
  while (match) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + match[0].length + 40);
    if (SSN_CUE.test(text.slice(start, end))) return true;
    match = NINE_DIGITS.exec(text);
  }
  return false;
}

function hasCardNumber(text) {
  CARD_CANDIDATE.lastIndex = 0;
  let match = CARD_CANDIDATE.exec(text);
  while (match) {
    const digits = match[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
    match = CARD_CANDIDATE.exec(text);
  }
  return false;
}

// Returns null when the message is fine, or { reason, message } when it must
// not be sent.
function checkOutgoing(body) {
  const text = typeof body === 'string' ? body : '';

  if (hasFormattedSsn(text) || hasCueSsn(text)) return { reason: 'ssn', message: BLOCK_MESSAGE };
  if (hasCardNumber(text)) return { reason: 'card', message: BLOCK_MESSAGE };
  if (BANK_CUE_THEN_DIGITS.test(text)) return { reason: 'bank', message: BLOCK_MESSAGE };

  return null;
}

// --- Soft warnings (shown to the recipient) -------------------------------

const WARNING_RULES = [
  {
    key: 'ssn_request',
    pattern: /(\bssn\b|social\s*security|social\s*sec\b)/i,
    text: 'This message mentions a Social Security number. PreCheckd never asks for one, and a real employer only collects it after a formal offer, through an official secure process — not in chat.'
  },
  {
    key: 'payment',
    pattern: /(wire\s*transfer|western\s*union|money\s*gram|zelle|cash\s*app|venmo|paypal|gift\s*cards?|bitcoin|cryptocurrency|crypto\s+(wallet|payment|transfer)|usdt|send\s+(me\s+)?money|reimburse|buy\s+(your\s+)?(own\s+)?equipment|cashier'?s\s+check|deposit\s+(this|the|a)\s+check)/i,
    text: 'This message mentions sending or receiving money. Legitimate recruiters never ask candidates to pay for anything or to deposit a check. If this feels off, don\'t go along with it — report it.'
  },
  {
    key: 'off_platform',
    pattern: /(telegram|whats\s*app|signal\s+app|\bkik\b|wechat|google\s*(chat|hangouts)|text\s+me|call\s+me\s+at|move\s+(this|our)\s+(conversation|chat)|off\s+(of\s+)?(this|the)\s+(site|platform|app))/i,
    text: 'This message suggests moving the conversation off PreCheckd. Off-platform, verification and safety protections no longer apply. If you do want to share contact details, use "Request contact info" so you stay in control.'
  },
  {
    // The fake-technical-interview attack: the "recruiter" asks the candidate
    // to clone a repo / run a script / open a project in VS Code or Cursor,
    // which silently runs code that steals credentials. Also catches
    // remote-control tools.
    key: 'run_code',
    pattern: /(git\s+clone|clone\s+(this|our|my|the\s+following)\s+(repo|repository|project)|run\s+(this|the\s+following)\s+(script|command|code)|(download|install)\s+(and\s+(run|install)\s+)?(this|the\s+attached)\s+(file|app|software|tool|extension|script|project)|open\s+(it|this|the\s+(project|repo|repository))\s+in\s+(vs\s?code|visual\s+studio|cursor)|anydesk|team\s?viewer|remote\s+(desktop|access|control))/i,
    text: 'This message asks you to clone a repo, run a script, install something or give remote access. Never do that for someone you met through hiring — it is a common attack that steals your passwords and takes over your computer. Legitimate technical screens run in your browser.'
  },
  {
    key: 'documents_codes',
    pattern: /(passport|driver'?s?\s*licen[sc]e|photo\s+of\s+your\s+id|copy\s+of\s+your\s+id|bank\s+statement|your\s+password|login\s+(details|credentials|info)|(send|share|give|forward|read)\s+(me\s+)?(the\s+|your\s+|that\s+)?(verification\s+|security\s+|one[-\s]?time\s+|login\s+|sms\s+|text\s+)?(code|passcode|otp)\b)/i,
    text: 'This message asks for an ID document, a password or a code. Be careful: never share passwords or verification codes with anyone, and only send ID documents through an official process after you have verified who is asking.'
  }
];

// Returns the list of warning texts that apply (one per matching category).
function warningsFor(body) {
  const text = typeof body === 'string' ? body : '';
  if (!text) return [];
  return WARNING_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.text);
}

module.exports = { BLOCK_MESSAGE, checkOutgoing, warningsFor };
