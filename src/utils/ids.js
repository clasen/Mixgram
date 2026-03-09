import crypto from 'crypto';

export function generateId(prefix = 'obs') {
  const hex = crypto.randomBytes(12).toString('hex');
  return `${prefix}_${hex}`;
}

export function observationId() {
  return generateId('obs');
}

export function sessionId() {
  return generateId('sess');
}

export function chunkId(documentId, index) {
  return `${documentId}_chunk_${index}`;
}

export function promptId() {
  return generateId('prompt');
}
