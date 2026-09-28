const normalizeRole = (role) => String(role || 'user').toLowerCase();

const normalizeId = (value) => String(value || '');

const getProjectPermissionEntry = (user, projectId) => {
  if (!user || !projectId) return null;
  const projectPermissions = Array.isArray(user.projectPermissions) ? user.projectPermissions : [];
  return projectPermissions.find((entry) => normalizeId(entry.projectId) === normalizeId(projectId)) || null;
};

const getAccessibleProjectIds = (user) => {
  const allowedProjects = Array.isArray(user?.allowedProjects) ? user.allowedProjects : [];
  const projectPermissions = Array.isArray(user?.projectPermissions) ? user.projectPermissions : [];
  const ids = new Set();

  allowedProjects.forEach((projectId) => ids.add(normalizeId(projectId)));
  projectPermissions.forEach((entry) => {
    if (entry?.projectId) {
      const id = normalizeId(entry.projectId);
      if (Array.isArray(entry.partIds) && entry.partIds.length > 0) ids.add(id);
      else ids.delete(id);
    }
  });

  return Array.from(ids).filter(Boolean);
};

const hasProjectAccess = (user, projectId) => {
  if (!user || !projectId) return false;
  if (normalizeRole(user.role) === 'admin') return true;

  const permissionEntry = getProjectPermissionEntry(user, projectId);
  if (permissionEntry) return Array.isArray(permissionEntry.partIds) && permissionEntry.partIds.length > 0;

  const allowedProjects = Array.isArray(user.allowedProjects) ? user.allowedProjects : [];
  if (allowedProjects.some((allowedProjectId) => normalizeId(allowedProjectId) === normalizeId(projectId))) {
    return true;
  }

  return false;
};

const hasProjectPartAccess = (user, projectId, sectionId) => {
  if (!user || !projectId || !sectionId) return false;
  if (normalizeRole(user.role) === 'admin') return true;

  const permissionEntry = getProjectPermissionEntry(user, projectId);
  if (permissionEntry) {
    return Array.isArray(permissionEntry.partIds) && permissionEntry.partIds.some((partId) => normalizeId(partId) === normalizeId(sectionId));
  }

  const allowedProjects = Array.isArray(user.allowedProjects) ? user.allowedProjects : [];
  return allowedProjects.some((allowedProjectId) => normalizeId(allowedProjectId) === normalizeId(projectId));
};

const normalizeSplitRatios = (splitRatios, splitPercent = 100) => {
  const ratios = Array.isArray(splitRatios)
    ? splitRatios.map((ratio) => Number(ratio)).filter((ratio) => Number.isInteger(ratio) && ratio >= 10 && ratio <= 100 && ratio % 10 === 0)
    : [];

  const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (ratios.length > 0 && ratioSum === 100) {
    return ratios;
  }

  const rawPercent = Number(splitPercent);
  const percentage = Number.isInteger(rawPercent) && rawPercent >= 10 && rawPercent <= 100 && rawPercent % 10 === 0
    ? rawPercent
    : 100;

  if (percentage >= 100) return [100];
  
  const rest = 100 - percentage;
  return rest > 0 && rest % 10 === 0 ? [percentage, rest] : [100];
};

const buildProjectParts = (totalImages, splitRatios = [], splitPercent = 100, imagesPerPart = null) => {
  if (totalImages <= 0) {
    return [];
  }

  const parts = [];
  let startIndex = 0;

  // If imagesPerPart is specified, divide by image count instead of percentage
  if (imagesPerPart && imagesPerPart > 0) {
    const numParts = Math.ceil(totalImages / imagesPerPart);
    for (let index = 0; index < numParts; index++) {
      const endIndex = index === numParts - 1
        ? totalImages
        : Math.min(totalImages, startIndex + imagesPerPart);
      
      parts.push({
        partId: String(index + 1),
        name: `Phần ${index + 1}`,
        startIndex,
        endIndex,
        percentage: Math.round((endIndex - startIndex) / totalImages * 100),
        order: index
      });

      startIndex = endIndex;
    }
    return parts;
  }

  // Otherwise, use percentage-based splitting (original logic)
  const ratios = normalizeSplitRatios(splitRatios, splitPercent);
  let cumulativeRatio = 0;

  ratios.forEach((ratio, index) => {
    cumulativeRatio += ratio;
    const rawEnd = index === ratios.length - 1
      ? totalImages
      : Math.round((totalImages * cumulativeRatio) / 100);
    const endIndex = Math.max(startIndex, Math.min(totalImages, rawEnd));
    parts.push({
      partId: String(index + 1),
      name: `Phần ${index + 1}`,
      startIndex,
      endIndex,
      percentage: ratio,
      order: index
    });

    startIndex = endIndex;
  });

  return parts;
};

const getImagePartMap = (images, splitRatios = [], splitPercent = 100, imagesPerPart = null) => {
  const sortedImages = [...images].sort((left, right) => {
    const leftDate = new Date(left.uploadDate || left.createdAt || 0).getTime();
    const rightDate = new Date(right.uploadDate || right.createdAt || 0).getTime();
    if (leftDate !== rightDate) return rightDate - leftDate;
    return String(left._id).localeCompare(String(right._id));
  });

  const spans = buildProjectParts(sortedImages.length, splitRatios, splitPercent, imagesPerPart);
  const map = new Map();

  spans.forEach((span) => {
    sortedImages.slice(span.startIndex, span.endIndex).forEach((imageDoc) => {
      const savedPartId = imageDoc.partId ? String(imageDoc.partId) : null;
      map.set(String(imageDoc._id), savedPartId ? { ...span, partId: savedPartId, name: `Phần ${savedPartId}` } : span);
    });
  });

  return { sortedImages, spans, map };
};

const getProjectPartIds = (images, splitRatios = [], splitPercent = 100, imagesPerPart = null) => {
  const hasSavedParts = images.some((image) => image.partId);
  const ids = new Set(imagesPerPart && hasSavedParts
    ? []
    : buildProjectParts(images.length, splitRatios, splitPercent, imagesPerPart).map((part) => part.partId));
  images.forEach((image) => {
    if (image.partId) ids.add(String(image.partId));
  });
  return [...ids].sort((a, b) => Number(a) - Number(b));
};

const assignNewImagePartIds = (project, images, count) => {
  const counts = new Map();
  images.forEach((image) => {
    if (image.partId) {
      const id = String(image.partId);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  });

  const assigned = [];
  const imagesPerPart = Number(project.imagesPerPart);
  let lastPartNumber = Math.max(
    Number(project.partSequence) || 0,
    ...[...counts.keys()].map(Number),
    0
  );

  for (let index = 0; index < count; index++) {
    let partId;
    if (Number.isInteger(imagesPerPart) && imagesPerPart > 0) {
      // An emptied part is never reused: its old user permissions may still exist.
      if (lastPartNumber === 0 || (counts.get(String(lastPartNumber)) || 0) >= imagesPerPart ||
          ((counts.get(String(lastPartNumber)) || 0) === 0 && Number(project.partSequence) >= lastPartNumber)) {
        lastPartNumber += 1;
      }
      partId = String(lastPartNumber);
    } else {
      const ratios = normalizeSplitRatios(project.splitRatios, project.splitPercent);
      const nextTotal = images.length + index + 1;
      let bestDeficit = -Infinity;
      let bestIndex = 0;
      ratios.forEach((ratio, ratioIndex) => {
        const deficit = (nextTotal * ratio / 100) - (counts.get(String(ratioIndex + 1)) || 0);
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestIndex = ratioIndex;
        }
      });
      partId = String(bestIndex + 1);
      lastPartNumber = Math.max(lastPartNumber, bestIndex + 1);
    }
    counts.set(partId, (counts.get(partId) || 0) + 1);
    assigned.push(partId);
  }

  return { partIds: assigned, lastPartNumber };
};

module.exports = {
  normalizeRole,
  hasProjectAccess,
  hasProjectPartAccess,
  getProjectPermissionEntry,
  getAccessibleProjectIds,
  normalizeSplitRatios,
  buildProjectParts,
  getImagePartMap,
  getProjectPartIds,
  assignNewImagePartIds
};
