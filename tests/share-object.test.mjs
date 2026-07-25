import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  ShareObject,
  ShareRate,
  shareRateBucketKey,
} from '../src/worker.js';


const VALID_ID = 'share_1234567890';
const SHARE_MAX_BYTES = 26 * 1024 * 1024;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const SHARE_RATE_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ORIGIN = 'https://weareone-link.org';

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.alarm = null;
    this.putCalls = [];
    this.setAlarmCalls = [];
    this.deleteAlarmCalls = 0;
    this.deleteAllCalls = 0;
  }

  async get(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      return new Map(
        keyOrKeys
          .filter((key) => this.values.has(key))
          .map((key) => [key, this.values.get(key)]),
      );
    }
    return this.values.get(keyOrKeys);
  }

  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === 'string') {
      this.values.set(keyOrEntries, value);
      this.putCalls.push([keyOrEntries, value]);
      return;
    }
    for (const [key, entryValue] of Object.entries(keyOrEntries)) {
      this.values.set(key, entryValue);
    }
    this.putCalls.push(keyOrEntries);
  }

  async setAlarm(at) {
    this.alarm = Number(at);
    this.setAlarmCalls.push(this.alarm);
  }

  async deleteAlarm() {
    this.alarm = null;
    this.deleteAlarmCalls += 1;
  }

  async deleteAll() {
    this.values.clear();
    this.deleteAllCalls += 1;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function copyBytes(body) {
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    );
  }
  throw new TypeError('expected an ArrayBuffer or typed-array body');
}

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.putCalls = [];
    this.getCalls = [];
    this.deleteCalls = [];
    this.deleteFailures = 0;
    this.nextDeleteBarrier = null;
  }

  async put(key, body, options) {
    const bytes = copyBytes(body);
    this.objects.set(key, bytes);
    this.putCalls.push({ key, bytes, options });
  }

  async get(key) {
    this.getCalls.push(key);
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      size: stored.byteLength,
      arrayBuffer: async () => stored.slice().buffer,
    };
  }

  async delete(key) {
    this.deleteCalls.push(key);
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error('simulated R2 delete failure');
    }
    if (this.nextDeleteBarrier) {
      const barrier = this.nextDeleteBarrier;
      this.nextDeleteBarrier = null;
      barrier.started.resolve();
      await barrier.release.promise;
    }
    this.objects.delete(key);
  }

  replace(key, body) {
    this.objects.set(key, copyBytes(body));
  }

  failNextDeletes(count = 1) {
    this.deleteFailures = count;
  }

  blockNextDelete() {
    const started = deferred();
    const release = deferred();
    this.nextDeleteBarrier = { started, release };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }
}

function fixture({ storage = new MemoryStorage(), r2 = new MemoryR2() } = {}) {
  const state = { storage };
  return {
    object: new ShareObject(state, { RELEASES: r2 }),
    r2,
    state,
    storage,
  };
}

function storeRequest(
  id,
  bytes,
  metadata = {},
) {
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'X-Share-Id': id,
  });
  const expiresAt = Object.hasOwn(metadata, 'expiresAt')
    ? metadata.expiresAt
    : Date.now() + 60_000;
  const expectedBytes = Object.hasOwn(metadata, 'expectedBytes')
    ? metadata.expectedBytes
    : bytes.byteLength;
  if (expiresAt !== undefined) {
    headers.set('X-Share-Expires-At', String(expiresAt));
  }
  if (expectedBytes !== undefined) {
    headers.set('X-Share-Bytes', String(expectedBytes));
  }
  return new Request('https://share-object/store', {
    method: 'POST',
    headers,
    body: bytes,
  });
}

function consumeRequest(id = VALID_ID) {
  return new Request('https://share-object/consume', {
    method: 'POST',
    headers: { 'X-Share-Id': id },
  });
}

async function storeAvailable(subject, bytes = Uint8Array.of(1, 2, 3, 4)) {
  const response = await subject.object.fetch(storeRequest(VALID_ID, bytes));
  assert.equal(response.status, 201);
  assert.equal((await subject.storage.get('lifecycle')).status, 'available');
  return bytes;
}

test('ShareObject serializes concurrent consumes so exactly one receives ciphertext', async () => {
  const subject = fixture();
  const ciphertext = await storeAvailable(subject);

  const responses = await Promise.all([
    subject.object.fetch(consumeRequest()),
    subject.object.fetch(consumeRequest()),
  ]);

  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 410]);
  const winner = responses.find(({ status }) => status === 200);
  assert.deepEqual(new Uint8Array(await winner.arrayBuffer()), ciphertext);
  assert.equal(subject.r2.deleteCalls.length, 1);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), false);
  assert.equal((await subject.storage.get('lifecycle')).status, 'consumed');
});

test('ShareObject does not release ciphertext until the R2 delete acknowledges', async () => {
  const subject = fixture();
  const ciphertext = await storeAvailable(subject);
  const barrier = subject.r2.blockNextDelete();
  let settled = false;

  const consume = subject.object.fetch(consumeRequest()).then((response) => {
    settled = true;
    return response;
  });
  await barrier.started;
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), true);
  assert.equal((await subject.storage.get('lifecycle')).status, 'consuming');

  barrier.release();
  const response = await consume;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Share-Lifecycle'), 'consumed-after-r2-delete-ack');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), ciphertext);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), false);
});

test('ShareObject restores retriable availability after a delete failure', async (t) => {
  t.mock.method(console, 'error', () => {});
  const subject = fixture();
  const ciphertext = await storeAvailable(subject);
  subject.r2.failNextDeletes();

  const failed = await subject.object.fetch(consumeRequest());
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /retry later/);
  const retriable = await subject.storage.get('lifecycle');
  assert.equal(retriable.status, 'available');
  assert.equal('claim_started_at' in retriable, false);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), true);

  const retried = await subject.object.fetch(consumeRequest());
  assert.equal(retried.status, 200);
  assert.deepEqual(new Uint8Array(await retried.arrayBuffer()), ciphertext);
  assert.equal(subject.r2.deleteCalls.length, 2);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), false);
});

test('ShareObject expiry alarm persists cleanup-pending state and retries deletion', async (t) => {
  t.mock.method(console, 'error', () => {});
  const subject = fixture();
  await storeAvailable(subject);
  const lifecycle = await subject.storage.get('lifecycle');
  lifecycle.expires_at = Date.now() - 1;
  await subject.storage.put('lifecycle', lifecycle);
  subject.r2.failNextDeletes();

  const beforeFirstAlarm = Date.now();
  await subject.object.alarm();
  const cleanupPending = await subject.storage.get('lifecycle');
  assert.equal(cleanupPending.status, 'cleanup-pending');
  assert.equal(cleanupPending.cleanup_reason, 'expiry-alarm');
  assert.ok(cleanupPending.cleanup_attempted_at >= beforeFirstAlarm);
  assert.ok(subject.storage.alarm > beforeFirstAlarm);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), true);

  await subject.object.alarm();
  assert.equal(subject.r2.deleteCalls.length, 2);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), false);
  assert.equal(await subject.storage.get('lifecycle'), undefined);
  assert.equal(subject.storage.alarm, null);
  assert.equal(subject.storage.deleteAllCalls, 1);
});

test('ShareObject rejects a stored object whose size disagrees with durable metadata', async (t) => {
  t.mock.method(console, 'error', () => {});
  const subject = fixture();
  await storeAvailable(subject, Uint8Array.of(1, 2, 3, 4));
  subject.r2.replace(`shares/${VALID_ID}`, Uint8Array.of(1, 2, 3));

  const response = await subject.object.fetch(consumeRequest());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /retry later/);
  assert.equal(subject.r2.deleteCalls.length, 0);
  assert.equal(subject.r2.objects.has(`shares/${VALID_ID}`), true);
  assert.equal((await subject.storage.get('lifecycle')).status, 'available');
});

test('ShareObject rejects an upload whose body size disagrees with declared metadata', async () => {
  const subject = fixture();
  const response = await subject.object.fetch(storeRequest(
    VALID_ID,
    Uint8Array.of(1, 2, 3),
    { expectedBytes: 4 },
  ));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid share body' });
  assert.equal(subject.r2.putCalls.length, 0);
  assert.equal(subject.r2.deleteCalls.length, 1);
  assert.equal(await subject.storage.get('lifecycle'), undefined);
  assert.equal(subject.storage.alarm, null);
});

test('ShareObject rejects duplicate initialization without replacing ciphertext', async () => {
  const subject = fixture();
  const original = Uint8Array.of(1, 2, 3, 4);
  await storeAvailable(subject, original);

  const duplicate = await subject.object.fetch(storeRequest(
    VALID_ID,
    Uint8Array.of(9, 9, 9, 9),
  ));

  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'share id already initialized' });
  assert.equal(subject.r2.putCalls.length, 1);
  assert.deepEqual(subject.r2.objects.get(`shares/${VALID_ID}`), original);
  assert.equal((await subject.storage.get('lifecycle')).status, 'available');
});

test('ShareObject rejects malformed IDs before touching storage', async () => {
  const invalidIds = [
    '',
    'short',
    'share_123456789',
    'share_12345678901',
    'share!1234567890',
    'share 1234567890',
  ];

  for (const id of invalidIds) {
    const subject = fixture();
    const response = await subject.object.fetch(storeRequest(
      id,
      Uint8Array.of(1),
    ));
    assert.equal(response.status, 400, `expected invalid ID to fail: ${JSON.stringify(id)}`);
    assert.deepEqual(await response.json(), { error: 'invalid share id' });
    assert.equal(subject.storage.putCalls.length, 0);
    assert.equal(subject.r2.putCalls.length, 0);
  }
});

test('ShareObject rejects invalid expiry and byte metadata before initialization', async () => {
  const now = Date.now();
  const invalidMetadata = [
    { label: 'missing expiry', metadata: { expiresAt: undefined } },
    { label: 'non-numeric expiry', metadata: { expiresAt: 'not-a-number' } },
    { label: 'fractional expiry', metadata: { expiresAt: now + 10_000.5 } },
    { label: 'past expiry', metadata: { expiresAt: now - 1 } },
    { label: 'expiry beyond allowed TTL', metadata: { expiresAt: now + SHARE_TTL_MS + 120_000 } },
    { label: 'missing byte count', metadata: { expectedBytes: undefined } },
    { label: 'zero byte count', metadata: { expectedBytes: 0 } },
    { label: 'negative byte count', metadata: { expectedBytes: -1 } },
    { label: 'fractional byte count', metadata: { expectedBytes: 1.5 } },
    { label: 'byte count over maximum', metadata: { expectedBytes: SHARE_MAX_BYTES + 1 } },
  ];

  for (const { label, metadata } of invalidMetadata) {
    const subject = fixture();
    const response = await subject.object.fetch(storeRequest(
      VALID_ID,
      Uint8Array.of(1, 2, 3, 4),
      metadata,
    ));
    assert.equal(response.status, 400, label);
    assert.deepEqual(await response.json(), { error: 'invalid share metadata' }, label);
    assert.equal(subject.storage.putCalls.length, 0, label);
    assert.equal(subject.r2.putCalls.length, 0, label);
  }
});

test('shareRateBucketKey coarsens IPv4 addresses to non-identifying /24 keys', () => {
  assert.equal(shareRateBucketKey('203.0.113.7'), 'v4:203.0.113');
  assert.equal(shareRateBucketKey('203.0.113.250'), 'v4:203.0.113');
  assert.equal(shareRateBucketKey(' 10.20.30.40 '), 'v4:10.20.30');
  assert.notEqual(shareRateBucketKey('203.0.113.7'), '203.0.113.7');
});

test('shareRateBucketKey canonicalizes IPv6 hosts to non-identifying /48 keys', () => {
  const expected = 'v6:2001:db8:abcd';
  assert.equal(shareRateBucketKey('2001:0DB8:ABCD:0001::1'), expected);
  assert.equal(shareRateBucketKey('2001:db8:abcd:ffff::dead'), expected);
  assert.equal(
    shareRateBucketKey('2001:0db8:abcd:0000:0000:0000:0000:0001'),
    expected,
  );
  assert.equal(shareRateBucketKey('::ffff:192.0.2.128'), 'v6:0:0:0');
  assert.equal(expected.includes('0001'), false);
});

test('shareRateBucketKey collapses malformed input without retaining raw identifiers', () => {
  const invalid = [
    undefined,
    '',
    'not-an-ip',
    '999.1.2.3',
    '203.0.113',
    '2001::db8::1',
    '2001:db8:zzzz::1',
    '2001:db8:1:2:3:4:5',
    '2001:db8:1:2:3:4:5:6:7',
    '::ffff:999.2.3.4',
  ];

  for (const candidate of invalid) {
    const key = shareRateBucketKey(candidate);
    assert.equal(key, 'unknown', `expected invalid address to collapse: ${String(candidate)}`);
    if (candidate) assert.equal(key.includes(candidate), false);
  }
});

test('ShareRate persists token consumption and schedules idle cleanup', async (t) => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const storage = new MemoryStorage();
  const rate = new ShareRate({ storage }, {});

  const response = await rate.fetch(new Request('https://share-rate/check?cost=1', {
    method: 'POST',
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, remaining: 11 });
  assert.equal(await storage.get('tokens'), 11);
  assert.equal(await storage.get('last_refill_ms'), now);
  assert.equal(storage.alarm, now + SHARE_RATE_IDLE_TTL_MS);
});

test('ShareRate returns deterministic retry timing and its alarm clears durable state', async (t) => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const storage = new MemoryStorage({ tokens: 0, last_refill_ms: now });
  const rate = new ShareRate({ storage }, {});

  const limited = await rate.fetch(new Request('https://share-rate/check?cost=1', {
    method: 'POST',
  }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '30');
  assert.deepEqual(await limited.json(), {
    ok: false,
    remaining: 0,
    retry_after_seconds: 30,
  });
  assert.equal(storage.alarm, now + SHARE_RATE_IDLE_TTL_MS);

  await rate.alarm();
  assert.equal(storage.values.size, 0);
  assert.equal(storage.alarm, null);
  assert.equal(rate.tokens, null);
  assert.equal(rate.lastRefillMs, null);

  const peek = await rate.fetch(new Request('https://share-rate/peek'));
  const state = await peek.json();
  assert.equal(state.tokens, 12);
  assert.equal(state.capacity, 12);
  assert.equal(state.refill_per_second, 2 / 60);
});

test('public share upload rejects a missing or malformed content length before storage', async () => {
  let namespaceTouched = false;
  const env = {
    RELEASES: {},
    SHARE_OBJECTS: {
      idFromName() {
        namespaceTouched = true;
        throw new Error('must not reach storage');
      },
    },
  };

  const missing = await worker.fetch(new Request(`${ORIGIN}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array([1]),
  }), env, {});
  assert.equal(missing.status, 411);
  assert.equal((await missing.json()).error, 'content-length required');

  const malformed = await worker.fetch(new Request(`${ORIGIN}/api/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '1e3',
    },
    body: new Uint8Array([1]),
  }), env, {});
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'invalid content-length');
  assert.equal(namespaceTouched, false);
});

test('public share upload rejects an oversized declaration without buffering the body', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(SHARE_MAX_BYTES + 1),
    },
    body: new Uint8Array([1]),
  }), {
    RELEASES: {},
    SHARE_OBJECTS: {},
  }, {});

  assert.equal(response.status, 413);
  assert.equal((await response.json()).max_bytes, SHARE_MAX_BYTES);
});

test('public share upload streams an admitted body to its per-object coordinator', async () => {
  const payload = new Uint8Array([9, 8, 7, 6]);
  let coordinatedId = null;
  let forwarded = null;
  const env = {
    RELEASES: {},
    SHARE_OBJECTS: {
      idFromName(id) {
        coordinatedId = id;
        return id;
      },
      get() {
        return {
          async fetch(request) {
            forwarded = request;
            return new Response(null, { status: 201 });
          },
        };
      },
    },
  };

  const response = await worker.fetch(new Request(`${ORIGIN}/api/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(payload.byteLength),
    },
    body: payload,
  }), env, {});

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, coordinatedId);
  assert.match(result.id, /^[A-Za-z0-9_-]{16}$/u);
  assert.equal(result.bytes, payload.byteLength);
  assert.ok(forwarded instanceof Request);
  assert.equal(forwarded.headers.get('X-Share-Bytes'), String(payload.byteLength));
  assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), payload);
});
