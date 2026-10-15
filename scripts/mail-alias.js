// Staff tool for PreCheckd mail addresses and the do-not-contact list.
//   npm run mail-alias -- show <candidate|recruiter> <alias>
//   npm run mail-alias -- disable <candidate|recruiter> <alias> [reason]
//   npm run mail-alias -- enable <candidate|recruiter> <alias>
//   npm run mail-alias -- block <address-or-domain> [note]     (do-not-contact)
//   npm run mail-alias -- unblock <address-or-domain>
// A disabled alias stops receiving at once; mail to it is dropped silently.
require('dotenv').config();
const { connectDatabase } = require('../src/config/database');
const MailAlias = require('../src/models/MailAlias');
const InboundEmail = require('../src/models/InboundEmail');
const Suppression = require('../src/models/Suppression');
const { addressFor } = require('../src/utils/mailAlias');

const [cmd, a, b, ...rest] = process.argv.slice(2);

async function main() {
  if (['show', 'disable', 'enable'].includes(cmd)) {
    const namespace = a;
    const alias = String(b || '').toLowerCase();
    const row = await MailAlias.findOne({ namespace, alias });
    if (!row) { console.log('No such alias.'); return; }
    if (cmd === 'disable') {
      row.status = 'disabled'; row.disabledReason = rest.join(' ') || null; row.disabledAt = new Date();
      await row.save();
    } else if (cmd === 'enable') {
      row.status = 'active'; row.disabledReason = null; row.disabledAt = null;
      await row.save();
    }
    const counts = await InboundEmail.aggregate([{ $match: { aliasId: row._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    console.log(`${addressFor(namespace, alias)}  status=${row.status}${row.disabledReason ? ` (${row.disabledReason})` : ''}`);
    console.log('received:', counts.map((c) => `${c._id}=${c.n}`).join(' ') || 'nothing yet');
  } else if (cmd === 'block') {
    const value = String(a || '').toLowerCase();
    await Suppression.updateOne({ value }, { $setOnInsert: { value, type: value.includes('@') ? 'address' : 'domain', reason: 'staff', note: [b, ...rest].filter(Boolean).join(' ') || null } }, { upsert: true });
    console.log(`Blocked ${value}`);
  } else if (cmd === 'unblock') {
    const res = await Suppression.deleteOne({ value: String(a || '').toLowerCase() });
    console.log(res.deletedCount ? 'Unblocked.' : 'Was not on the list.');
  } else {
    console.log('Commands: show|disable|enable <candidate|recruiter> <alias> [reason]; block|unblock <address-or-domain> [note]');
  }
}

connectDatabase()
  .then(main)
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
