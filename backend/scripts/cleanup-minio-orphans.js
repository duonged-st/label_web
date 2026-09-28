/**
 * cleanup-minio-orphans.js
 *
 * Tìm và xóa tất cả object trong MinIO bucket "originals"
 * mà không có bản ghi tương ứng trong collection Image của MongoDB.
 *
 * Cách chạy (từ thư mục backend/ hoặc trong Docker container):
 *   node scripts/cleanup-minio-orphans.js              ← xóa thật
 *   node scripts/cleanup-minio-orphans.js --dry-run    ← chỉ liệt kê
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');

// ─── Config ────────────────────────────────────────────────────────────────────
const MONGO_URI    = process.env.MONGO_URI         || 'mongodb://admin:admin@mongodb:27017/image_annotation?authSource=admin';
const MINIO_HOST   = process.env.MINIO_ENDPOINT    || 'minio';
const MINIO_PORT   = Number(process.env.MINIO_PORT) || 9000;
const ACCESS_KEY   = process.env.MINIO_ACCESS_KEY  || 'admin';
const SECRET_KEY   = process.env.MINIO_SECRET_KEY  || 'admin123';
const BUCKET       = 'originals';
const PAGE_SIZE    = 1000;   // objects per S3 list page
const DELETE_BATCH = 500;    // parallel deletes per round
const DRY_RUN      = process.argv.includes('--dry-run');

// ─── AWS Signature v4 (bare-minimum for S3 GET/DELETE) ─────────────────────────
const hmac    = (key, data)  => crypto.createHmac('sha256', key).update(data).digest();
const hmacHex = (key, data)  => crypto.createHmac('sha256', key).update(data).digest('hex');

const sign = (method, path, query, body = '') => {
  const now = new Date();
  const date     = now.toISOString().slice(0, 10).replace(/-/g, '');   // 20240101
  const datetime = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; // 20240101T000000Z
  const region   = 'us-east-1';
  const service  = 's3';

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonHeaders = `host:${MINIO_HOST}:${MINIO_PORT}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${datetime}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  // sort query params
  const sortedQuery = query
    ? Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&')
    : '';

  const canonRequest = [method, path, sortedQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
  const credScope = `${date}/${region}/${service}/aws4_request`;
  const strToSign = ['AWS4-HMAC-SHA256', datetime, credScope, crypto.createHash('sha256').update(canonRequest).digest('hex')].join('\n');

  const sigKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), region), service), 'aws4_request');
  const sig    = hmacHex(sigKey, strToSign);

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
    'x-amz-date': datetime,
    'x-amz-content-sha256': payloadHash,
  };
};

// ─── HTTP helper ───────────────────────────────────────────────────────────────
const httpGet = (path, query = {}) =>
  new Promise((resolve, reject) => {
    const qs  = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
    const url = `/${path}${qs ? '?' + qs : ''}`;
    const headers = sign('GET', `/${path}`, query);

    const req = http.request({ hostname: MINIO_HOST, port: MINIO_PORT, path: url, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });

const httpDelete = (path) =>
  new Promise((resolve, reject) => {
    const headers = sign('DELETE', `/${path}`, {});
    const req = http.request({ hostname: MINIO_HOST, port: MINIO_PORT, path: `/${path}`, method: 'DELETE', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

// ─── MinIO listing (raw XML parse, no SDK) ─────────────────────────────────────
const extractTags = (xml, tag) => {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
};

const listAllMinioObjects = async () => {
  const names = [];
  let token = null;
  let page  = 0;

  while (true) {
    const query = { 'list-type': '2', 'max-keys': String(PAGE_SIZE) };
    if (token) query['continuation-token'] = token;

    const xml  = await httpGet(`${BUCKET}`, query);
    const keys = extractTags(xml, 'Key');
    names.push(...keys);
    page++;
    process.stdout.write(`\r      Trang ${page}: đã liệt kê ${names.length.toLocaleString()} objects...`);

    // kiểm tra có trang tiếp không
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    if (!truncated) break;
    const nextTokens = extractTags(xml, 'NextContinuationToken');
    token = nextTokens[0] || null;
    if (!token) break;
  }

  process.stdout.write('\n');
  return names;
};

// ─── MinIO delete helpers ─────────────────────────────────────────────────────
const deleteMinioObjects = async (names) => {
  let deleted = 0;
  let failed  = 0;
  for (let i = 0; i < names.length; i += DELETE_BATCH) {
    const batch   = names.slice(i, i + DELETE_BATCH);
    const results = await Promise.allSettled(
      batch.map((name) => httpDelete(`${BUCKET}/${encodeURIComponent(name)}`))
    );
    deleted += results.filter((r) => r.status === 'fulfilled').length;
    failed  += results.filter((r) => r.status === 'rejected').length;
    process.stdout.write(`\r  Đã xóa ${deleted}/${names.length}...`);
  }
  process.stdout.write('\n');
  return { deleted, failed };
};

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (DRY_RUN) console.log('⚠️  DRY-RUN mode: sẽ chỉ liệt kê, KHÔNG xóa thật.\n');

  // 1. Connect MongoDB
  console.log('[1/4] Kết nối MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('      ✅ Kết nối thành công.\n');

  const ImageModel = mongoose.model(
    'Image',
    new mongoose.Schema({ filename: String, storageKey: String, path: String }, { collection: 'images', strict: false })
  );

  // 2. Đọc filenames từ DB
  console.log('[2/4] Đọc filenames từ MongoDB...');
  const dbDocs = await ImageModel.find({}, { filename: 1, storageKey: 1, path: 1 }).lean();
  const dbFilenames = new Set();
  for (const doc of dbDocs) {
    if (doc.storageKey) {
      dbFilenames.add(doc.storageKey);
    } else if (doc.path) {
      const parts = String(doc.path).split('/');
      const name  = parts[parts.length - 1];
      if (name) dbFilenames.add(name);
    } else if (doc.filename) {
      dbFilenames.add(doc.filename);
    }
  }
  console.log(`      ✅ ${dbFilenames.size.toLocaleString()} filenames trong DB.\n`);

  // 3. Liệt kê MinIO
  console.log(`[3/4] Liệt kê objects trong bucket "${BUCKET}"...`);
  const minioObjects = await listAllMinioObjects();
  console.log(`      ✅ ${minioObjects.length.toLocaleString()} objects trên MinIO.\n`);

  // 4. Tìm orphan
  const orphans = minioObjects.filter((name) => !dbFilenames.has(name));
  console.log(`[4/4] Orphan objects: ${orphans.length.toLocaleString()} / ${minioObjects.length.toLocaleString()}`);
  console.log(`      Objects có trong DB: ${(minioObjects.length - orphans.length).toLocaleString()}`);

  if (orphans.length === 0) {
    console.log('\n✅ Không có orphan. MinIO sạch rồi!');
    await mongoose.disconnect();
    return process.exit(0);
  }

  console.log('\n  Ví dụ orphan objects:');
  orphans.slice(0, 10).forEach((n) => console.log(`    - ${n}`));
  if (orphans.length > 10) console.log(`    ... và ${orphans.length - 10} cái nữa.`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN: Chạy lại không có --dry-run để xóa thật.');
    await mongoose.disconnect();
    return process.exit(0);
  }

  // Xóa thật
  console.log(`\n  Đang xóa ${orphans.length.toLocaleString()} orphan objects...`);
  const { deleted, failed } = await deleteMinioObjects(orphans);
  console.log(`\n  ✅ Đã xóa: ${deleted.toLocaleString()}`);
  if (failed > 0) console.warn(`  ⚠️  Không xóa được: ${failed.toLocaleString()}`);

  await mongoose.disconnect();
  console.log('\n✅ Hoàn thành!');
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (err) => {
  console.error('\n❌ Script lỗi:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
