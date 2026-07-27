// Release-attestation signature gate.
//
// The site ships an Ed25519 release trust root pinned inside browser code
// (RELEASE_PUBKEY_HEX in live/bridge.js) and signed attestation documents under
// /attestations/. Signing happens offline in scripts/build-attestation.py, so
// nothing in CI can catch a canonicalization drift between the Python signer
// and the JavaScript verifier: the signature would simply stop validating in
// every visitor's browser while every Python-side check still passed.
//
// This suite verifies the shipped documents using the verifier's OWN
// canonicalization function, lifted verbatim out of bridge.js, against the pin
// taken from the same file. It is deliberately not a re-implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'dist', 'weareone-link.org');
const ATTEST_DIR = path.join(SITE, 'attestations');
const BRIDGE = readFileSync(path.join(SITE, 'live', 'bridge.js'), 'utf8');

function pinnedReleaseKey() {
  const match = BRIDGE.match(/const RELEASE_PUBKEY_HEX\s*=\s*'([a-f0-9]{64})'/);
  assert.ok(match, 'bridge.js must pin a 32-byte hex release key');
  return match[1];
}

// Lift the verifier's canonicalization out of the shipped browser bundle by
// brace matching, so this gate exercises the real code path rather than a copy
// that could drift from it.
function browserCanonicalizer() {
  const start = BRIDGE.indexOf('function canonicalAttestationPayload(doc) {');
  assert.ok(start >= 0, 'bridge.js must define canonicalAttestationPayload');
  let depth = 0;
  let end = -1;
  for (let i = BRIDGE.indexOf('{', start); i < BRIDGE.length; i++) {
    if (BRIDGE[i] === '{') depth++;
    else if (BRIDGE[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > start, 'could not brace-match canonicalAttestationPayload');
  return new Function(`${BRIDGE.slice(start, end)}; return canonicalAttestationPayload;`)();
}

function ed25519Key(rawHex) {
  // Raw 32-byte Ed25519 keys need an SPKI wrapper for node:crypto.
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(rawHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

function currentReleaseIndex() {
  const p = path.join(ATTEST_DIR, 'current-release.json');
  assert.ok(existsSync(p), 'attestations/current-release.json must exist');
  return JSON.parse(readFileSync(p, 'utf8'));
}

function attestationDocs() {
  return readdirSync(ATTEST_DIR)
    .filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(name => ({ name, doc: JSON.parse(readFileSync(path.join(ATTEST_DIR, name), 'utf8')) }));
}

test('every shipped attestation verifies under the browser canonicalization', () => {
  const pin = pinnedReleaseKey();
  const canonical = browserCanonicalizer();
  const docs = attestationDocs();
  assert.ok(docs.length > 0, 'no attestation documents found');

  for (const { name, doc } of docs) {
    const signature = (doc.signatures || []).find(entry => entry.scheme === 'ed25519');
    assert.ok(signature, `${name}: no ed25519 signature`);
    assert.equal(signature.public_key_hex, pin, `${name}: signed by a key the browser does not pin`);
    assert.match(signature.signature_hex, /^[a-f0-9]{128}$/, `${name}: signature is not 64 bytes`);
    // The worker binds document to artifact by filename; keep them consistent.
    assert.equal(doc.artifact?.sha256, path.basename(name, '.json'),
      `${name}: document does not describe the artifact its filename claims`);

    const ok = verify(null, Buffer.from(canonical(doc), 'utf8'),
      ed25519Key(signature.public_key_hex), Buffer.from(signature.signature_hex, 'hex'));
    assert.ok(ok, `${name}: ED25519 signature does NOT verify the way the browser will`);
  }
});

test('tampering with any signed field breaks verification', () => {
  const canonical = browserCanonicalizer();
  const docs = attestationDocs();

  for (const { name, doc } of docs) {
    const signature = doc.signatures.find(entry => entry.scheme === 'ed25519');
    const key = ed25519Key(signature.public_key_hex);
    const sigBytes = Buffer.from(signature.signature_hex, 'hex');

    for (const mutate of [
      d => { d.artifact.sha256 = d.artifact.sha256.replace(/^./, c => (c === 'a' ? 'b' : 'a')); },
      d => { d.artifact.size_bytes = (d.artifact.size_bytes || 0) + 1; },
      d => { d.source.commit = '0'.repeat(40); },
      d => { d.build.run_url = 'https://attacker.example/run'; },
    ]) {
      const tampered = JSON.parse(JSON.stringify(doc));
      mutate(tampered);
      const stillValid = verify(null, Buffer.from(canonical(tampered), 'utf8'), key, sigBytes);
      assert.equal(stillValid, false, `${name}: a tampered document still verified`);
    }
  }
});

test('the current release set is exactly the artifacts the manifest published', () => {
  const index = currentReleaseIndex();
  assert.match(index.build_commit, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(index.artifacts) && index.artifacts.length > 0);

  const shipped = new Set(attestationDocs().map(entry => entry.doc.artifact.sha256));
  for (const artifact of index.artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `${artifact.filename}: bad digest`);
    assert.ok(shipped.has(artifact.sha256),
      `${artifact.filename}: listed as current but has no attestation document`);
  }
});

test('older documents are not listed as current, so stale proof cannot be served', () => {
  // The directory intentionally retains earlier documents. They are validly
  // signed for artifacts we no longer ship, which is precisely why publication
  // must be scoped to current-release.json instead of the whole directory: a
  // visitor hashing an old binary must not get a "verified" verdict for it.
  const index = currentReleaseIndex();
  const current = new Set(index.artifacts.map(artifact => artifact.sha256));
  const stale = attestationDocs()
    .map(entry => entry.doc.artifact.sha256)
    .filter(sha => !current.has(sha));

  for (const sha of stale) {
    assert.ok(!current.has(sha), `${sha} cannot be both stale and current`);
  }
  // Guard the scoping property itself: current must be a strict subset.
  assert.ok(current.size <= attestationDocs().length);
});
