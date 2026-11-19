const crypto = require('crypto');

// Cifrado simétrico para los tokens de Google guardados en la base. La clave
// sale de JWT_SECRET: un backup de la .db filtrado no alcanza para usar los
// refresh tokens. Consecuencia a saber: rotar JWT_SECRET deja ilegibles los
// tokens guardados y cada persona tiene que reconectar Google Calendar.
const KEY = crypto.createHash('sha256').update(`gcal:${process.env.JWT_SECRET || ''}`).digest();

function encrypt(plain) {
  if (plain === null || plain === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  if (!payload) return null;
  try {
    const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

function randomUid() {
  return crypto.randomBytes(16).toString('base64url');
}

module.exports = { encrypt, decrypt, randomUid };
