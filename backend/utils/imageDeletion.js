const Image = require('../models/Image');
const Evaluation = require('../models/Evaluation');
const Segmentation = require('../models/Segmentation');
const { minioClient, BUCKET_NAME } = require('../config/minio');
const { getImageObjectName } = require('./imageFile');

const isObjectMissing = (error) =>
  error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404);

const removeObjectSafe = async (objectName) => {
  try {
    await minioClient.removeObject(BUCKET_NAME, objectName);
  } catch (error) {
    if (isObjectMissing(error)) return;
    throw error;
  }
};

const deleteImageWithStorage = async (image) => {
  const imageId = image._id;
  const wasPending = Boolean(image.deletionPending);
  const marked = await Image.updateOne({ _id: imageId }, { $set: { deletionPending: true } });
  if (marked.matchedCount === 0) return false;

  let storageRemoved = false;
  let storageConfirmedPresent = false;
  try {
    const objectName = getImageObjectName(image);
    if (objectName) {
      try {
        await removeObjectSafe(objectName);
      } catch (removeError) {
        // A lost MinIO acknowledgement can report an error after the object
        // was removed. Check before deciding whether the DB record is usable.
        try {
          await minioClient.statObject(BUCKET_NAME, objectName);
          storageConfirmedPresent = true;
        } catch (statError) {
          if (!isObjectMissing(statError)) throw removeError;
        }
        if (storageConfirmedPresent) throw removeError;
      }
    }
    storageRemoved = true;
    // If either DB delete fails, the pending record stays hidden and the same
    // request can be retried. MinIO deletion is idempotent.
    await Evaluation.deleteMany({ imageId });
    await Segmentation.deleteMany({ imageId });
    await Image.deleteOne({ _id: imageId, deletionPending: true });
    return true;
  } catch (error) {
    if (!storageRemoved && storageConfirmedPresent && !wasPending) {
      try {
        await Image.updateOne({ _id: imageId }, { $set: { deletionPending: false } });
      } catch (resetError) {
        console.error('Không thể khôi phục trạng thái ảnh sau lỗi MinIO:', resetError);
      }
    }
    throw error;
  }
};

const processProjectImageBatch = async (images) => {
  const results = await Promise.allSettled(images.map(deleteImageWithStorage));
  const deletedCount = results.filter((result) => result.status === 'fulfilled' && result.value).length;
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Không thể xóa ảnh ${images[index]._id}:`, result.reason);
    }
  });
  return { deletedCount, failedCount };
};

const deleteProjectImagesInBatches = async (projectId, batchSize = 250) => {
  const cursor = Image.find({ projectId }).select('_id filename storageKey path deletionPending').lean().cursor();
  let batch = [];
  const totals = { deletedCount: 0, failedCount: 0 };

  const flush = async () => {
    const result = await processProjectImageBatch(batch);
    totals.deletedCount += result.deletedCount;
    totals.failedCount += result.failedCount;
    batch = [];
  };

  for await (const image of cursor) {
    batch.push(image);
    if (batch.length >= batchSize) await flush();
  }
  if (batch.length > 0) await flush();
  return totals;
};

module.exports = { deleteImageWithStorage, deleteProjectImagesInBatches };
