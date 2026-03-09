import crypto from 'crypto';

export function contentHash(content) {
  if (typeof content !== 'string') content = String(content);
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
