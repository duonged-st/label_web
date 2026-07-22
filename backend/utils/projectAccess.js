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
      ids.add(normalizeId(entry.projectId));
    }
  });

  return Array.from(ids).filter(Boolean);
};

const hasProjectAccess = (user, projectId) => {
  if (!user || !projectId) return false;
  if (normalizeRole(user.role) === 'admin') return true;

  const allowedProjects = Array.isArray(user.allowedProjects) ? user.allowedProjects : [];
  if (allowedProjects.some((allowedProjectId) => normalizeId(allowedProjectId) === normalizeId(projectId))) {
    return true;
  }

  return Boolean(getProjectPermissionEntry(user, projectId));
};

const hasProjectPartAccess = (user, projectId, sectionId) => {
  if (!user || !projectId || !sectionId) return false;
  if (normalizeRole(user.role) === 'admin') return true;

  const allowedProjects = Array.isArray(user.allowedProjects) ? user.allowedProjects : [];
  if (allowedProjects.some((allowedProjectId) => normalizeId(allowedProjectId) === normalizeId(projectId))) {
    return true;
  }

  const permissionEntry = getProjectPermissionEntry(user, projectId);
  if (!permissionEntry) return false;

  const partIds = Array.isArray(permissionEntry.partIds) ? permissionEntry.partIds : [];
  return partIds.some((partId) => normalizeId(partId) === normalizeId(sectionId));
};

const normalizeSplitRatios = (splitRatios, splitPercent = 100) => {
  const ratios = Array.isArray(splitRatios)
    ? splitRatios.map((ratio) => Number(ratio)).filter((ratio) => Number.isInteger(ratio) && ratio >= 10 && ratio <= 100 && ratio % 10 === 0)
    : [];

  const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (ratios.length > 0 && ratioSum === 100) {
    return ratios;
  }

  const percentage = Math.min(100, Math.max(10, Number(splitPercent) || 100));
  if (percentage >= 100) return [100];
  
  const rest = 100 - percentage;
  return rest > 0 ? [percentage, rest] : [100];
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
      map.set(String(imageDoc._id), span);
    });
  });

  return { sortedImages, spans, map };
};

module.exports = {
  normalizeRole,
  hasProjectAccess,
  hasProjectPartAccess,
  getProjectPermissionEntry,
  getAccessibleProjectIds,
  normalizeSplitRatios,
  buildProjectParts,
  getImagePartMap
};