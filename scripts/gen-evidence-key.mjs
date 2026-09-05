#!/usr/bin/env node
/**
 * Generate an Ed25519 signing key for the tamper-evident evidence store.
 *
 *   node scripts/gen-evidence-key.mjs [output-private-key.pem]
 *
 * Then run the app with SENTRA_EVIDENCE_SIGNING_KEY pointing at the file. For a
 * real deployment, keep the PRIVATE key OFF the capture box (OS keychain / HSM /
 * a separate volume) — its whole value is that a machine-level tamperer cannot
 * re-sign edited records. Publish the printed fingerprint + public key out of
 * band so recipients can trust the right key. (*.pem is gitignored.)
 */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'evidence-signing-key.pem';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const keyId = createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex')
  .slice(0, 16);

writeFileSync(out, privPem, { mode: 0o600 });

console.log(`Ed25519 signing key written to ${out} (mode 0600).`);
console.log(`\nkey_id (fingerprint): ${keyId}`);
console.log(`\nPublic key — publish this out of band so verifiers trust it:\n${pubPem}`);
console.log('Run the app with:');
console.log(`  SENTRA_EVIDENCE_SIGNING_KEY=${out} ENABLE_EVIDENCE_CAPTURE=true npm run dev`);
console.log('\nKeep the PRIVATE key off the capture box for real deployments.');
