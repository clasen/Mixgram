import crypto from 'crypto';

const ALPHANUM = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateId() {
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHANUM[bytes[i] % 36];
  return s;
}

export function observationId() {
  return generateId();
}

export function sessionId() {
  return generateId();
}

export function chunkId(documentId, index) {
  return `${documentId}_${index}`;
}

export function promptId() {
  return generateId();
}

