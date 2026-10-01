const crypto = require('crypto');
const Coupon = require('../models/Coupon');

// Avoids visually ambiguous characters (0/O, 1/I/L) so codes are easy to
// read and type correctly off a screen or printed page.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 5;

function generateRandomCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// Generates a code guaranteed unique against existing Coupon documents,
// retrying on the rare collision before giving up.
async function generateUniqueCode() {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateRandomCode();
    const existing = await Coupon.findOne({ code: candidate });
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('Could not generate a unique coupon code after several attempts.');
}

async function createCoupon({
  issuedToEmail,
  source,
  sourceId = null,
  partnerId = null,
  discountType,
  discountValue,
  expiresInDays,
}) {
  const code = await generateUniqueCode();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const coupon = new Coupon({
    code,
    issuedToEmail: issuedToEmail.trim().toLowerCase(),
    source,
    sourceId,
    partnerId,
    discountType,
    discountValue,
    expiresAt,
  });

  await coupon.save();
  return coupon;
}

module.exports = { generateUniqueCode, createCoupon };