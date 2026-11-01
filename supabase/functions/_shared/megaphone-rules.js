// Megaphone message rules, shared by the website preview (dist/megaphone-rules.mjs is an identical copy, checked by check.mjs)
// and the checkout function, which is the one that enforces them.
export const MAX_MESSAGE = 120, MAX_SENDER = 20, MIN_MESSAGE = 3;
const BLOCKED = /\b(n[i1]gg|f[a@]gg|r[e3]tard|k[i1]ll\s*yoursel|kys\b|nazi)/i;
const LINK = /(https?:\/\/|www\.|discord\.(gg|com\/invite)|\b[a-z0-9-]+\.(com|net|org|gg|io|xyz|ru|me|ly)\b)/i;
const TRADE_REAL_MONEY = /\b(paypal|venmo|cash\s*app|\$\s*\d|usd|rmt|buy\s+mesos?\s+for\s+\$|selling\s+mesos?\s+for\s+\$)/i;

export function cleanText(s, max) {
  return String(s ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Returns { message, sender, errors[] }. Anything with errors must not be sold.
export function checkMegaphone(input) {
  const message = cleanText(input?.message, MAX_MESSAGE + 1), sender = cleanText(input?.sender, MAX_SENDER + 1);
  const errors = [];
  if (message.length < MIN_MESSAGE) errors.push(`Write at least ${MIN_MESSAGE} characters.`);
  if (message.length > MAX_MESSAGE) errors.push(`Keep it to ${MAX_MESSAGE} characters.`);
  if (sender.length > MAX_SENDER) errors.push(`Keep the name to ${MAX_SENDER} characters.`);
  for (const [text, label] of [[message, 'Message'], [sender, 'Name']]) {
    if (LINK.test(text)) errors.push(`${label}: links and invites are not allowed.`);
    if (BLOCKED.test(text)) errors.push(`${label}: please remove the offensive wording.`);
    if (TRADE_REAL_MONEY.test(text)) errors.push(`${label}: real-money trading is not allowed.`);
  }
  const letters = message.replace(/[^a-z]/gi, '');
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) errors.push('Please don’t write the whole message in capitals.');
  if (/(.)\1{5,}/.test(message)) errors.push('Please remove repeated characters.');
  return { message: message.slice(0, MAX_MESSAGE), sender: sender.slice(0, MAX_SENDER), errors };
}
