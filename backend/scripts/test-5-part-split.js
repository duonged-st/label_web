const assert = require('assert');
const path = require('path');

process.env.JWT_SECRET = 'mot_chuoi_bi_mat_that_la_dai_va_kho_doan_123';
process.env.MINIO_ENDPOINT = '127.0.0.1';

const { buildProjectParts, getImagePartMap, hasProjectPartAccess, hasProjectAccess, normalizeSplitRatios } = require('../utils/projectAccess');

console.log('=== TEST SCENARIO: PROJECT SPLIT INTO 5 EQUAL PARTS (20% each) ===');

// 1. Check split normalization for 5 equal parts (20% each)
const splitRatios = [20, 20, 20, 20, 20];
const normalized = normalizeSplitRatios(splitRatios);
assert.deepStrictEqual(normalized, [20, 20, 20, 20, 20], 'Split ratios must normalize to 5 parts of 20%');
console.log('1. Normalized 5-part ratios: OK');

// 2. Create 100 mock images with dates and IDs
const totalImages = 100;
const mockImages = Array.from({ length: totalImages }, (_, i) => ({
  _id: `img_${String(i).padStart(3, '0')}`,
  uploadDate: new Date(Date.now() - i * 1000), // sorted descending by date
  projectId: 'proj_123'
}));

// 3. Build project parts
const parts = buildProjectParts(mockImages.length, splitRatios);
assert.strictEqual(parts.length, 5, 'Must have exactly 5 parts');
assert.strictEqual(parts[0].partId, '1');
assert.strictEqual(parts[1].partId, '2');
assert.strictEqual(parts[2].partId, '3');
assert.strictEqual(parts[3].partId, '4');
assert.strictEqual(parts[4].partId, '5');
console.log('2. Generated 5 parts spans: OK');
parts.forEach(p => console.log(`   - Part ${p.partId}: index ${p.startIndex} -> ${p.endIndex} (${p.endIndex - p.startIndex} images, ${p.percentage}%)`));

// 4. Test image part mapping
const { map: imagePartMap } = getImagePartMap(mockImages, splitRatios);
assert.strictEqual(imagePartMap.size, 100, 'All 100 images must be mapped to parts');

// Sample test images across all 5 parts
const sampleImgPart1 = mockImages[5];  // index 5 -> Part 1
const sampleImgPart2 = mockImages[25]; // index 25 -> Part 2
const sampleImgPart3 = mockImages[45]; // index 45 -> Part 3
const sampleImgPart4 = mockImages[65]; // index 65 -> Part 4
const sampleImgPart5 = mockImages[85]; // index 85 -> Part 5

assert.strictEqual(imagePartMap.get(sampleImgPart1._id).partId, '1');
assert.strictEqual(imagePartMap.get(sampleImgPart2._id).partId, '2');
assert.strictEqual(imagePartMap.get(sampleImgPart3._id).partId, '3');
assert.strictEqual(imagePartMap.get(sampleImgPart4._id).partId, '4');
assert.strictEqual(imagePartMap.get(sampleImgPart5._id).partId, '5');
console.log('3. Image part mapping for all 5 parts: OK');

// 5. Test Access Permissions:
// Case A: Admin user
const adminUser = {
  userId: 'user_admin',
  role: 'admin',
  allowedProjects: [],
  projectPermissions: []
};

// Admin must have access to all 5 parts
for (let p = 1; p <= 5; p++) {
  assert.strictEqual(hasProjectPartAccess(adminUser, 'proj_123', String(p)), true, `Admin must have access to Part ${p}`);
}
console.log('4. Admin access to all 5 parts: OK (PASS)');

// Case B: User assigned only to Part 1
const userPart1Only = {
  userId: 'user_p1',
  role: 'user',
  allowedProjects: ['proj_123'],
  projectPermissions: [{ projectId: 'proj_123', partIds: ['1'] }]
};

assert.strictEqual(hasProjectPartAccess(userPart1Only, 'proj_123', '1'), true, 'User P1 must have access to Part 1');
assert.strictEqual(hasProjectPartAccess(userPart1Only, 'proj_123', '2'), false, 'User P1 must NOT have access to Part 2');
assert.strictEqual(hasProjectPartAccess(userPart1Only, 'proj_123', '3'), false, 'User P1 must NOT have access to Part 3');
assert.strictEqual(hasProjectPartAccess(userPart1Only, 'proj_123', '4'), false, 'User P1 must NOT have access to Part 4');
assert.strictEqual(hasProjectPartAccess(userPart1Only, 'proj_123', '5'), false, 'User P1 must NOT have access to Part 5');
console.log('5. User assigned only to Part 1 (isolated access): OK (PASS)');

// Case C: User assigned to Parts 2, 3, 4, 5
const userMultiParts = {
  userId: 'user_multi',
  role: 'user',
  allowedProjects: ['proj_123'],
  projectPermissions: [{ projectId: 'proj_123', partIds: ['2', '3', '4', '5'] }]
};

assert.strictEqual(hasProjectPartAccess(userMultiParts, 'proj_123', '1'), false, 'User must NOT have access to Part 1');
assert.strictEqual(hasProjectPartAccess(userMultiParts, 'proj_123', '2'), true, 'User must have access to Part 2');
assert.strictEqual(hasProjectPartAccess(userMultiParts, 'proj_123', '3'), true, 'User must have access to Part 3');
assert.strictEqual(hasProjectPartAccess(userMultiParts, 'proj_123', '4'), true, 'User must have access to Part 4');
assert.strictEqual(hasProjectPartAccess(userMultiParts, 'proj_123', '5'), true, 'User must have access to Part 5');
console.log('6. User assigned to Parts 2, 3, 4, 5: OK (PASS)');

// Case D: User assigned to all 5 parts
const userAllParts = {
  userId: 'user_all',
  role: 'user',
  allowedProjects: ['proj_123'],
  projectPermissions: [{ projectId: 'proj_123', partIds: ['1', '2', '3', '4', '5'] }]
};

for (let p = 1; p <= 5; p++) {
  assert.strictEqual(hasProjectPartAccess(userAllParts, 'proj_123', String(p)), true, `User must have access to Part ${p}`);
}
console.log('7. User assigned to all 5 parts: OK (PASS)');

console.log('\n>>> TOÀN BỘ CÁC BÀI TEST CHIA 5 PHẦN & GÁN NHÃN ĐÃ PASS THÀNH CÔNG! <<<');
process.exit(0);
