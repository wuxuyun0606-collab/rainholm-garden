import { randomBytes } from 'node:crypto';
console.log('Keep these private. Paste into Cloudflare secret fields, never a chat or public repository.');
for (const key of ['GARDEN_USER_KEY', 'GARDEN_AI_KEY']) console.log(`${key}=${randomBytes(32).toString('base64url')}`);
