const assert = require('assert');
const path = require('path');

process.env.JWT_SECRET = 'mot_chuoi_bi_mat_that_la_dai_va_kho_doan_123';
process.env.MINIO_ENDPOINT = '127.0.0.1';
process.env.MINIO_PORT = '9000';
process.env.MINIO_ACCESS_KEY = 'test_access';
process.env.MINIO_SECRET_KEY = 'test_secret';
process.env.MINIO_BUCKET_NAME = 'test_bucket';

console.log('=== TEST 1: MinIO Config ===');
const { minioClient, BUCKET_NAME, MINIO_ACCESS_KEY, MINIO_SECRET_KEY } = require('../config/minio');
assert.strictEqual(BUCKET_NAME, 'test_bucket');
assert.strictEqual(MINIO_ACCESS_KEY, 'test_access');
assert.strictEqual(MINIO_SECRET_KEY, 'test_secret');
assert(minioClient !== undefined && minioClient !== null);
minioClient.bucketExists = async () => true;
minioClient.makeBucket = async () => {};
minioClient.setBucketPolicy = async () => {};
console.log('PASS: MinIO config loads environment variables correctly.');

console.log('\n=== TEST 2: normalizeSplitRatios & Validation ===');
const { normalizeSplitRatios, buildProjectParts, hasProjectAccess, normalizeRole } = require('../utils/projectAccess');

assert.deepStrictEqual(normalizeSplitRatios([30, 70]), [30, 70]);
assert.deepStrictEqual(normalizeSplitRatios([50, 50]), [50, 50]);
assert.deepStrictEqual(normalizeSplitRatios([10, 20, 70]), [10, 20, 70]);
assert.deepStrictEqual(normalizeSplitRatios([100]), [100]);
assert.deepStrictEqual(normalizeSplitRatios([33, 67]), [100]);
assert.deepStrictEqual(normalizeSplitRatios([], 30), [30, 70]);
assert.deepStrictEqual(normalizeSplitRatios([], 50), [50, 50]);
assert.deepStrictEqual(normalizeSplitRatios([], 100), [100]);
assert.deepStrictEqual(normalizeSplitRatios([], 33), [100]);
console.log('PASS: normalizeSplitRatios works correctly.');

console.log('\n=== TEST 3: buildProjectParts for single-part and multi-part ===');
const partsSingle = buildProjectParts(100, [100]);
assert.strictEqual(partsSingle.length, 1);
assert.strictEqual(partsSingle[0].partId, '1');

const partsMulti = buildProjectParts(100, [30, 70]);
assert.strictEqual(partsMulti.length, 2);
assert.strictEqual(partsMulti[0].partId, '1');
assert.strictEqual(partsMulti[1].partId, '2');
console.log('PASS: buildProjectParts generates correct part IDs.');

console.log('\n=== TEST 4: Auth Middleware Exports & Function Signature ===');
const authMiddleware = require('../middleware/authmiddleware');
assert.strictEqual(typeof authMiddleware.verifyToken, 'function');
assert.strictEqual(typeof authMiddleware.verifyAdmin, 'function');
assert.strictEqual(typeof authMiddleware.verifyProjectAccess, 'function');
assert.strictEqual(typeof authMiddleware.hasProjectAccess, 'function');
console.log('PASS: authmiddleware exports all required functions.');

console.log('\n=== TEST 5: Verify Controllers Syntax & Export ===');
console.log('Loading projectController...');
const projectController = require('../controllers/project');
console.log('Loading userController...');
const userController = require('../controllers/user');
console.log('Loading uploadController...');
const uploadController = require('../controllers/upload');
console.log('Loading imageController...');
const imageController = require('../controllers/image');

assert(projectController !== undefined);
assert(userController !== undefined);
assert(uploadController !== undefined);
assert(imageController !== undefined);

console.log('PASS: All controllers loaded successfully without errors.');
console.log('\n>>> ALL 5 TESTS PASSED SUCCESSFULLY! <<<');
process.exit(0);
