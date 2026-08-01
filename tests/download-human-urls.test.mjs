// The download route must answer the URLs people actually type.
//
// A visitor hit https://weareone-link.org/download/windows and got
// "Nothing here. Try the network." The canonical spec resolved fine; the
// TRAILING SLASH did not, because the route pattern ended at the spec and the
// request fell through to the static assets and rendered the generic 404.
// Every other page on this site ends in a slash (/download/, /features/), so
// that is the natural thing to type.
//
// These pin the guessable forms. A download route that only answers its own
// canonical spelling is a route most visitors never reach.

import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.js';

const ORIGIN = 'https://weareone-link.org';
const HTML = { Accept: 'text/html,application/xhtml+xml' };

async function fetchRoute(route, headers = {}) {
  return worker.fetch(new Request(`${ORIGIN}${route}`, { headers }), {}, {});
}

function isArtifactRedirect(response) {
  if (response.status !== 302) return false;
  const location = response.headers.get('Location') || '';
  return location.includes('/releases/download/');
}

test('a trailing slash still reaches the artifact', async () => {
  for (const route of [
    '/download/windows/',
    '/download/linux/',
    '/download/windows-x86_64/',
    '/download/linux-arm64/',
  ]) {
    const response = await fetchRoute(route, HTML);
    assert.ok(
      isArtifactRedirect(response),
      `${route} did not redirect to an artifact (status ${response.status}, ` +
        `location ${response.headers.get('Location')})`,
    );
  }
});

test('common shorthands resolve to the same artifact as the canonical spec', async () => {
  const pairs = [
    ['/download/win', '/download/windows'],
    ['/download/windows-x64', '/download/windows-x86_64'],
    ['/download/windows-intel', '/download/windows-x86_64'],
    ['/download/linux-x64', '/download/linux-x86_64'],
    ['/download/linux-arm', '/download/linux-arm64'],
  ];
  for (const [alias, canonical] of pairs) {
    const aliasResponse = await fetchRoute(alias, HTML);
    const canonicalResponse = await fetchRoute(canonical, HTML);
    assert.equal(
      aliasResponse.headers.get('Location'),
      canonicalResponse.headers.get('Location'),
      `${alias} did not resolve like ${canonical}`,
    );
  }
});

test('a file extension is not a dead end', async () => {
  for (const route of ['/download/windows.exe', '/download/windows-x86_64.exe']) {
    const response = await fetchRoute(route, HTML);
    assert.ok(
      isArtifactRedirect(response),
      `${route} did not redirect to an artifact (status ${response.status})`,
    );
  }
});

test('an unknown platform sends a browser to the picker, not a dead end', async () => {
  const response = await fetchRoute('/download/nonsense-platform', HTML);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/download/');
});

test('machine clients keep the explicit JSON 404 contract', async () => {
  const response = await fetchRoute('/download/nonsense-platform', {
    Accept: 'application/json',
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'unknown platform');
  assert.ok(Array.isArray(body.available));
});

test('the macOS page does not title itself "not yet" while offering a download', async () => {
  // macOS reaches the coming-soon template only because a browser cannot
  // reveal Intel vs Apple Silicon. The BODY offers a real Apple Silicon
  // build, so a tab reading "not yet" contradicts the page and tells most Mac
  // owners there is nothing for them.
  const response = await fetchRoute('/download/macos', HTML);
  const body = await response.text();
  const title = (body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  assert.ok(title.includes('macOS'), `title lost its platform: ${title}`);
  assert.ok(
    !/not yet/i.test(title),
    `macOS offers a build, so the title must not say "not yet": ${title}`,
  );
  // ...and the page must still actually offer that download.
  assert.match(body, /Apple Silicon/i);
});

test('a platform with no build still says "not yet"', async () => {
  // The suffix is correct for platforms that genuinely have nothing.
  const response = await fetchRoute('/download/android', HTML);
  const body = await response.text();
  const title = (body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  assert.match(title, /not yet/i, `expected the coming-soon suffix: ${title}`);
});

test('aliasing never invents an artifact that is not published', async () => {
  // macOS Intel has no build. A shorthand must not smuggle the user onto the
  // arm64 binary; it has to keep failing honestly.
  for (const route of ['/download/mac-x64', '/download/macos-intel', '/download/osx-x86_64']) {
    const response = await fetchRoute(route, HTML);
    assert.notEqual(response.status, 302, `${route} redirected instead of refusing`);
    assert.equal(response.headers.get('Location'), null);
  }
});
