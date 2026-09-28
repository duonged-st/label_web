const assert = require('node:assert/strict');
const {
  assignNewImagePartIds,
  getAccessibleProjectIds,
  getImagePartMap,
  getProjectPartIds,
  hasProjectAccess,
  hasProjectPartAccess
} = require('../utils/projectAccess');
const { withProjectWriteLock } = require('../utils/projectWriteLock');

const image = (id, day, partId = null) => ({
  _id: id,
  uploadDate: new Date(`2026-01-${String(day).padStart(2, '0')}`),
  partId
});

const oldImages = [image('A', 1, '2'), image('B', 2, '1')];
const percentageProject = { splitRatios: [50, 50], splitPercent: 50, partSequence: 2 };
const nextPercentage = assignNewImagePartIds(percentageProject, oldImages, 2);
assert.deepEqual(nextPercentage.partIds, ['1', '2']);

const withNewImages = [
  ...oldImages,
  image('C', 3, nextPercentage.partIds[0]),
  image('D', 4, nextPercentage.partIds[1])
];
const percentageMap = getImagePartMap(withNewImages, [50, 50]).map;
assert.equal(percentageMap.get('A').partId, '2');
assert.equal(percentageMap.get('B').partId, '1');

const countProject = { imagesPerPart: 2, partSequence: 2 };
const countImages = [image('A', 1, '1'), image('B', 2, '1'), image('C', 3, '2')];
assert.deepEqual(assignNewImagePartIds(countProject, countImages, 3).partIds, ['2', '3', '3']);
assert.deepEqual(
  assignNewImagePartIds({ imagesPerPart: 2, partSequence: 3 }, countImages, 1).partIds,
  ['4']
);
assert.deepEqual(getProjectPartIds([image('A', 1, '4')], [], 100, 2), ['4']);

const revoked = {
  role: 'user',
  allowedProjects: ['project-1'],
  projectPermissions: [{ projectId: 'project-1', partIds: [] }]
};
assert.equal(hasProjectAccess(revoked, 'project-1'), false);
assert.equal(hasProjectPartAccess(revoked, 'project-1', '1'), false);
assert.deepEqual(getAccessibleProjectIds(revoked), []);

const checkSerializedWrites = async () => {
  let active = 0;
  let maxActive = 0;
  await Promise.all(Array.from({ length: 3 }, () => withProjectWriteLock('project-1', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  })));
  assert.equal(maxActive, 1);
  await assert.rejects(withProjectWriteLock('project-1', async () => { throw new Error('expected'); }));
  await withProjectWriteLock('project-1', async () => { assert.equal(active, 0); });
  console.log('Stable image assignment, revoked permission, and serialized write checks passed.');
};

checkSerializedWrites().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
