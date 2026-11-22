// POLY-99 R11 harness self-test: fake-b2 behaves the way the ruling and the measurements (M-U1..M-U6) say B2's S3 and native halves do,
// reached the way the uploader reaches it (TLS, a network alias, a test CA). No script under test here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT, S3_HOST, TOOLS, sh, teardown, up, type Stack } from './stack.ts';
import { type Fake, startFake } from './uploader.ts';

let s: Stack;
let fake: Fake;
let setupError: string | null = null;
beforeAll(() => {
  try { s = up({ uploader: 'stub' }); fake = startFake(s); } catch (e) { setupError = String((e as Error).message); teardown(); }
}, 900_000);
afterAll(() => { if (fake) fake.stop(); if (s) s.down(); });
beforeEach(() => { if (setupError) throw new Error(setupError); fake.reset(); });

// a client on upload-net with the test CA as its only trust, like the uploader
const client = (script: string) => sh('docker', ['run', '--rm', '--network', `${PROJECT}_upload-net`, '-v', `${s.dir}/pki/ca.crt:/ca.crt:ro`, '--entrypoint', 'bash', TOOLS, '-c', script]);
const URL = `https://${S3_HOST}/poly-test-bucket`;
const md5b64 = 'printf hello | openssl dgst -md5 -binary | base64';
const put = (obj: string, extra = '') => `curl -s --cacert /ca.crt -o /dev/null -D - -X PUT -H "Content-MD5: $(${md5b64})" -H 'Authorization: AWS4-HMAC-SHA256 Credential=KEYID1/20260101/x/s3/aws4_request' ${extra} --data-binary hello ${URL}/${obj}`;

describe('fake-b2 S3 half', () => {
  it('a single-part PUT with the right Content-MD5 -> 200, ETag is the md5 hex, a new version is stored; a second PUT of the same name is a second version', () => {
    const a = client(put('i/17/dump/a'));
    expect(a.out).toMatch(/HTTP\/1\.1 200/);
    expect(a.out.toLowerCase()).toContain('etag: "5d41402abc4b2a76b9719d911017c592"');
    client(put('i/17/dump/a'));
    expect(fake.store()['i/17/dump/a']).toHaveLength(2);
    expect(fake.log()).toEqual(['PUT KEYID1 /poly-test-bucket/i/17/dump/a', 'PUT KEYID1 /poly-test-bucket/i/17/dump/a']);
  });
  it('a wrong Content-MD5 -> 400 BadDigest and nothing stored', () => {
    const r = client(`curl -s --cacert /ca.crt -X PUT -H "Content-MD5: AAAAAAAAAAAAAAAAAAAAAA==" --data-binary hello ${URL}/x`);
    expect(r.out).toContain('BadDigest');
    expect(fake.store()).toEqual({});
  });
  it('HEAD, GET, DELETE and list are 403 AccessDenied and are logged', () => {
    const c = 'curl -s --cacert /ca.crt -o /dev/null -w "%{http_code} "';
    const codes = client(`${c} -I ${URL}/o; ${c} ${URL}/o; ${c} -X DELETE ${URL}/o; ${c} "${URL}?list-type=2"`);
    expect(codes.out.trim()).toBe('403 403 403 403');
    expect(fake.log().map((l) => l.split(' ')[0])).toEqual(['HEAD', 'GET', 'DELETE', 'GET']);
  });
  it('modes: etag (32 zeros), refuse (403), 5xx (500), permissive (DELETE succeeds)', () => {
    fake.mode('etag');
    expect(client(put('o1')).out.toLowerCase()).toContain(`etag: "${'0'.repeat(32)}"`);
    fake.mode('refuse');
    expect(client(put('o2')).out).toMatch(/HTTP\/1\.1 403/);
    fake.mode('5xx');
    expect(client(put('o3')).out).toMatch(/HTTP\/1\.1 500/);
    fake.mode('permissive');
    expect(client(`curl -s --cacert /ca.crt -o /dev/null -w "%{http_code}" -X DELETE ${URL}/o1`).out).toBe('204');
  });
  it('a client without the test CA is refused by TLS (the real CA bundle is not what the fake presents)', () => {
    expect(client(`curl -s -o /dev/null -w "%{http_code}" ${URL}/o`).out).not.toBe('403');
  });
});

describe('fake-b2 native half (restore/drill through POLY_B2_AUTH_URL)', () => {
  const api = (path: string, auth: string) => sh('curl', ['-s', '-H', `Authorization: ${auth}`, `${fake.nativeUrl}${path}`]).out;
  const basic = (id: string, k: string) => `Basic ${Buffer.from(`${id}:${k}`).toString('base64')}`;
  it('b2_authorize_account accepts the read key only; the box key (and anything else) is 401', () => {
    expect(JSON.parse(api('/b2api/v3/b2_authorize_account', basic('0049fixturereadkeyid00000001', 'K004FIXTUREREADAPPKEY0000000000000'))).authorizationToken).toBeTruthy();
    expect(JSON.parse(api('/b2api/v3/b2_authorize_account', basic('0049fixturekeyid0000000001', 'K004FIXTUREAPPLICATIONKEY00000000000'))).code).toBe('unauthorized');
  });
  it('lists versions (newest first per name, hide markers as action=hide) and downloads one by fileId; an untokened call is 401', () => {
    const auth = JSON.parse(api('/b2api/v3/b2_authorize_account', basic('0049fixturereadkeyid00000001', 'K004FIXTUREREADAPPKEY0000000000000')));
    const tok = auth.authorizationToken as string;
    expect(auth.apiInfo.storageApi.allowed.buckets[0].name).toBe('poly-test-bucket');
    fake.ctl('plant?name=i/17/dump/a&uploaded=1000', { post: true });
    fake.ctl('plant?name=i/17/dump/a&uploaded=2000', { post: true });
    fake.ctl('plant?name=i/17/dump/a&uploaded=3000&action=hide', { post: true });
    const list = JSON.parse(api('/b2api/v3/b2_list_file_versions?bucketId=bucketid-fixture-0001&prefix=i/', tok));
    expect(list.files.map((f: any) => [f.action, f.uploadTimestamp])).toEqual([['hide', 3000], ['upload', 2000], ['upload', 1000]]);
    expect(api('/b2api/v3/b2_list_file_versions?bucketId=bucketid-fixture-0001', 'nope')).toContain('unauthorized');
    expect(api(`/b2api/v3/b2_download_file_by_id?fileId=${list.files[1].fileId}`, tok)).toBe('');
  });
});
