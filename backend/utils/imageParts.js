const Image = require('../models/Image');
const Project = require('../models/Project');
const { getImagePartMap, getProjectPermissionEntry, normalizeRole } = require('./projectAccess');

const imageFields = '_id partId uploadDate createdAt';

const writeAssignments = async (images, map, missingOnly) => {
  const updates = images
    .filter((image) => !missingOnly || !image.partId)
    .map((image) => ({
      updateOne: {
        filter: missingOnly ? { _id: image._id, partId: null } : { _id: image._id },
        update: { $set: { partId: String(map.get(String(image._id)).partId) } }
      }
    }));
  if (updates.length > 0) await Image.bulkWrite(updates, { ordered: false });
  return Math.max(0, ...[...map.values()].map((part) => Number(part.partId) || 0));
};

const ensureProjectImageParts = async (project) => {
  if (!project) return;
  const missing = await Image.exists({ projectId: project._id, partId: null });
  if (!missing) return;
  const images = await Image.find({ projectId: project._id }).select(imageFields).lean();
  const { map } = getImagePartMap(images, project.splitRatios, project.splitPercent, project.imagesPerPart);
  const lastPartNumber = await writeAssignments(images, map, true);
  await Project.updateOne({ _id: project._id }, { $max: { partSequence: lastPartNumber } });
};

const reassignProjectImageParts = async (project) => {
  const images = await Image.find({ projectId: project._id }).select(imageFields).lean();
  const withoutSavedParts = images.map((image) => ({ ...image, partId: null }));
  const { map } = getImagePartMap(withoutSavedParts, project.splitRatios, project.splitPercent, project.imagesPerPart);
  const lastPartNumber = await writeAssignments(images, map, false);
  await Project.updateOne({ _id: project._id }, { $set: { partSequence: lastPartNumber } });
  return lastPartNumber;
};

const canUserAccessImage = async (user, project, image) => {
  if (normalizeRole(user?.role) === 'admin') return true;
  const permission = getProjectPermissionEntry(user, project?._id);
  if (!Array.isArray(permission?.partIds) || permission.partIds.length === 0) return false;

  let partId = image?.partId ? String(image.partId) : '';
  if (!partId) {
    const images = await Image.find({ projectId: project._id }).select(imageFields).lean();
    const { map } = getImagePartMap(images, project.splitRatios, project.splitPercent, project.imagesPerPart);
    partId = String(map.get(String(image._id))?.partId || '');
  }
  return permission.partIds.some((allowedPartId) => String(allowedPartId) === partId);
};

module.exports = { ensureProjectImageParts, reassignProjectImageParts, canUserAccessImage };
