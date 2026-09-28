const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;

const getImageDisplayName = (image) => {
  const name = String(image?.filename || '').trim();
  if (!name) return 'Unknown';
  // Older images stored the MinIO key in filename.
  return !image?.storageKey ? (name.match(UUID_PREFIX)?.[1] || name) : name;
};

const getImageObjectName = (image) => {
  if (image?.storageKey) return image.storageKey;
  if (image?.path) {
    const name = String(image.path).split('/').pop();
    if (name) return name;
  }
  // Fallback for older records without a path.
  return image?.filename || null;
};

module.exports = { getImageDisplayName, getImageObjectName };
