const express = require('express');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const AiModel = require('../models/AiModel');
const Image = require('../models/Image');
const Evaluation = require('../models/Evaluation');
const User = require('../models/User');
const { verifyAdmin, normalizeRole } = require('../middleware/authmiddleware');
const { getAccessibleProjectIds, buildProjectParts, getProjectPartIds, normalizeSplitRatios } = require('../utils/projectAccess');
const { ensureProjectImageParts, reassignProjectImageParts } = require('../utils/imageParts');
const { deleteProjectImagesInBatches } = require('../utils/imageDeletion');
const { withProjectWriteLock } = require('../utils/projectWriteLock');
const { buildClassCatalog } = require('../utils/segmentationValidation');
const router = express.Router();

const labelError = (status, message) => Object.assign(new Error(message), { status });

const validateLabels = (labels) => {
  if (!Array.isArray(labels)) throw labelError(400, 'Danh sách nhãn phải là một mảng.');
  const normalized = labels.map((label) => {
    if (typeof label !== 'string' || !label.trim()) {
      throw labelError(400, 'Mỗi nhãn phải là một tên không rỗng.');
    }
    return label.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw labelError(400, 'Tên nhãn trong dự án không được trùng nhau.');
  }
  return normalized;
};

const planLabelUpdate = (currentLabels, requestedLabels, change) => {
  const nextLabels = validateLabels(requestedLabels);
  const current = Array.isArray(currentLabels) ? currentLabels : [];
  if (change === undefined) {
    if (current.some((label) => !nextLabels.includes(label))) {
      throw labelError(400, 'Đổi hoặc xóa nhãn cần chỉ rõ thao tác để cập nhật kết quả gán nhãn.');
    }
    return { nextLabels, migration: null };
  }

  if (!change || typeof change !== 'object' || Array.isArray(change) ||
      !['rename', 'delete'].includes(change.type) ||
      typeof change.from !== 'string' || !current.includes(change.from)) {
    throw labelError(409, 'Nhãn đã thay đổi. Vui lòng tải lại dự án rồi thử lại.');
  }
  if (change.type === 'rename' && (typeof change.to !== 'string' || !change.to.trim())) {
    throw labelError(400, 'Vui lòng nhập tên nhãn mới.');
  }

  const to = change.type === 'rename' ? change.to.trim() : null;
  const expected = change.type === 'rename'
    ? current.map((label) => label === change.from ? to : label)
    : current.filter((label) => label !== change.from);
  if (JSON.stringify(nextLabels) !== JSON.stringify(expected) ||
      (change.type === 'rename' && (to === change.from || current.includes(to)))) {
    throw labelError(409, 'Danh sách nhãn đã thay đổi. Vui lòng tải lại dự án rồi thử lại.');
  }
  return { nextLabels, migration: { type: change.type, from: change.from, to } };
};

const isTransactionUnsupported = (error) =>
  /Transaction numbers are only allowed on a replica set member or mongos|Standalone topology does not support transactions/i.test(error?.message || '');

const updateProjectAndEvaluations = async (projectId, nextBody, migration) => {
  const query = { projectId, finalLabels: migration.from };
  const loadSnapshots = (session) => {
    const pending = Evaluation.find(query).lean();
    return session ? pending.session(session) : pending;
  };
  const updateEvaluations = async (session, snapshots) => {
    const options = session ? { session } : {};
    if (migration.type === 'rename') {
      await Evaluation.updateMany(query, [{
        $set: {
          finalLabels: {
            $map: {
              input: '$finalLabels', as: 'label',
              in: { $cond: [{ $eq: ['$$label', migration.from] }, migration.to, '$$label'] }
            }
          }
        }
      }], { ...options, updatePipeline: true });
    } else {
      await Evaluation.updateMany(query, { $pull: { finalLabels: migration.from } }, options);
      // An evaluation with no labels should return to the unlabelled state.
      for (let offset = 0; offset < snapshots.length; offset += 500) {
        const ids = snapshots.slice(offset, offset + 500).map((evaluation) => evaluation._id);
        await Evaluation.deleteMany({ _id: { $in: ids }, finalLabels: { $size: 0 } }, options);
      }
    }
  };
  const updateProject = (session) => Project.findByIdAndUpdate(
    projectId, nextBody, { new: true, ...(session ? { session } : {}) }
  ).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');

  // Replica sets get a MongoDB transaction. The bundled single-node MongoDB
  // cannot run transactions, so it uses a serialized write with compensation.
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession();
    try {
      let updated;
      await session.withTransaction(async () => {
        const snapshots = await loadSnapshots(session);
        await updateEvaluations(session, snapshots);
        updated = await updateProject(session);
        if (!updated) throw labelError(404, 'Không tìm thấy dự án!');
      });
      return updated;
    } catch (error) {
      if (!isTransactionUnsupported(error)) throw error;
    } finally {
      await session.endSession();
    }
  }

  const snapshots = await loadSnapshots();
  try {
    await updateEvaluations(undefined, snapshots);
    const updated = await updateProject();
    if (!updated) throw labelError(404, 'Không tìm thấy dự án!');
    return updated;
  } catch (error) {
    if (snapshots.length > 0) {
      try {
        await Evaluation.bulkWrite(snapshots.map((evaluation) => ({
          replaceOne: {
            filter: { _id: evaluation._id }, replacement: evaluation, upsert: true
          }
        })), { ordered: false });
      } catch (restoreError) {
        console.error('Không khôi phục được kết quả gán nhãn sau lỗi cập nhật dự án:', restoreError);
      }
    }
    throw error;
  }
};

const validateSplitRatios = (splitRatios) => {
  if (!Array.isArray(splitRatios) || splitRatios.length === 0) {
    return { valid: false, message: 'Vui lòng cấu hình ít nhất một phần cho dự án.' };
  }

  const normalized = splitRatios.map((ratio) => Number(ratio));
  const invalid = normalized.find(
    (ratio) => !Number.isInteger(ratio) || ratio < 10 || ratio > 100 || ratio % 10 !== 0
  );
  if (invalid !== undefined) {
    return { valid: false, message: 'Mỗi phần phải là bội số của 10, từ 10% đến 100%.' };
  }

  const sum = normalized.reduce((total, ratio) => total + ratio, 0);
  if (sum !== 100) {
    return { valid: false, message: 'Tổng tỉ lệ các phần phải bằng 100%.' };
  }

  return { valid: true, ratios: normalized };
};

router.post('/projects', verifyAdmin, async (req, res) => {
  const { name, description, labels, splitRatios, splitPercent, aiModelId } = req.body;
  try {
    const projectLabels = labels === undefined ? [] : validateLabels(labels);
    const existingProject = await Project.findOne({ name });
    if (existingProject) {
      return res.status(400).json({ message: 'Tên bộ dữ liệu này đã tồn tại!' });
    }

    if (aiModelId) {
      const aiModel = await AiModel.findById(aiModelId);
      if (!aiModel) {
        return res.status(404).json({ message: 'Không tìm thấy AI model được chọn!' });
      }
    }

    let finalSplitRatios = [100];
    let finalSplitPercent = 100;

    if (splitRatios !== undefined && Array.isArray(splitRatios) && splitRatios.length > 0) {
      const ratioCheck = validateSplitRatios(splitRatios);
      if (!ratioCheck.valid) {
        return res.status(400).json({ message: ratioCheck.message });
      }
      finalSplitRatios = ratioCheck.ratios;
      finalSplitPercent = ratioCheck.ratios[0] || 100;
    } else if (splitPercent !== undefined) {
      const sp = Number(splitPercent);
      if (!Number.isInteger(sp) || sp < 10 || sp > 100 || sp % 10 !== 0) {
        return res.status(400).json({ message: 'Tỉ lệ chia phải từ 10 đến 100 và tăng theo bước 10%.' });
      }
      finalSplitPercent = sp;
      finalSplitRatios = normalizeSplitRatios([], sp);
    }

    const newProject = new Project({
      name,
      description,
      labels: projectLabels,
      aiModelId: aiModelId || null,
      splitPercent: finalSplitPercent,
      splitRatios: finalSplitRatios
    });
    await newProject.save();
    await newProject.populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');
    res.status(201).json({ 
      message: 'Tạo bộ dữ liệu thành công!', 
      project: newProject 
    });
  } catch (error) {
    if (!error.status) console.error("Lỗi khi tạo project:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Lỗi server' });
  }
});

router.get('/projects', async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const query = role === 'admin'
      ? {}
      : { _id: { $in: getAccessibleProjectIds(req.user) } };

    const projects = await Project.find(query).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap').sort({ createdAt: -1 });
    if (role === 'admin') {
      const projectIds = projects.map((project) => project._id);
      const legacyIds = await Image.distinct('projectId', { projectId: { $in: projectIds }, partId: null });
      const legacyIdSet = new Set(legacyIds.map(String));
      await Promise.all(projects.filter((project) => legacyIdSet.has(String(project._id))).map(ensureProjectImageParts));
      const partCounts = await Image.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: { projectId: '$projectId', partId: '$partId' }, count: { $sum: 1 } } }
      ]);
      const countsByProject = new Map();
      partCounts.forEach(({ _id, count }) => {
        const id = String(_id.projectId);
        if (!countsByProject.has(id)) countsByProject.set(id, {});
        countsByProject.get(id)[String(_id.partId)] = count;
      });
      return res.status(200).json(projects.map((project) => {
        const counts = countsByProject.get(String(project._id)) || {};
        return {
          ...project.toObject(),
          imageCount: Object.values(counts).reduce((total, count) => total + count, 0),
          partCounts: counts
        };
      }));
    }

    const permissionMap = new Map((req.user?.projectPermissions || []).map((entry) => [String(entry.projectId), entry]));
    const filteredProjects = projects.filter((project) => {
      const permissionEntry = permissionMap.get(String(project._id));
      return Boolean(permissionEntry && Array.isArray(permissionEntry.partIds) && permissionEntry.partIds.length > 0);
    });

    return res.status(200).json(filteredProjects);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.put('/projects/:id', verifyAdmin, async (req, res) => {
  try {
    const nextBody = { ...req.body };
    delete nextBody.segmentationClasses;
    const labelChange = nextBody.labelChange;
    delete nextBody.labelChange;
    if (labelChange !== undefined && nextBody.labels === undefined) {
      return res.status(400).json({ message: 'Thiếu danh sách nhãn cho thao tác cập nhật.' });
    }
    const projectId = req.params.id;
    const existingProject = await Project.findById(projectId);
    if (!existingProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    let splitConfigChanged = false;

    if (nextBody.aiModelId !== undefined) {
      if (nextBody.aiModelId) {
        const aiModel = await AiModel.findById(nextBody.aiModelId);
        if (!aiModel) {
          return res.status(404).json({ message: 'Không tìm thấy AI model được chọn!' });
        }
      }
    }

    if (nextBody.splitPercent !== undefined) {
      const splitPercent = Number(nextBody.splitPercent);
      if (!Number.isInteger(splitPercent) || splitPercent < 10 || splitPercent > 100 || splitPercent % 10 !== 0) {
        return res.status(400).json({ message: 'Tỉ lệ chia phải từ 10 đến 100 và tăng theo bước 10%.' });
      }
      nextBody.splitPercent = splitPercent;
      splitConfigChanged = true;
    }

    if (nextBody.splitRatios !== undefined) {
      // Allow empty array when using imagesPerPart mode
      if (Array.isArray(nextBody.splitRatios) && nextBody.splitRatios.length === 0) {
        nextBody.splitRatios = [];
        splitConfigChanged = true;
      } else {
        const ratioCheck = validateSplitRatios(nextBody.splitRatios);
        if (!ratioCheck.valid) {
          return res.status(400).json({ message: ratioCheck.message });
        }
        nextBody.splitRatios = ratioCheck.ratios;
        splitConfigChanged = true;
      }
    }

    if (nextBody.imagesPerPart !== undefined && nextBody.imagesPerPart !== null) {
      const ipp = Number(nextBody.imagesPerPart);
      if (!Number.isInteger(ipp) || ipp < 1) {
        return res.status(400).json({ message: 'Số ảnh/phần phải là số nguyên dương.' });
      }
      nextBody.imagesPerPart = ipp;
      splitConfigChanged = true;
    } else if (nextBody.imagesPerPart === null) {
      nextBody.imagesPerPart = null;
      splitConfigChanged = true;
    }

    // server-side validation: ensure the configured parts are feasible given current image count
    if (splitConfigChanged) {
      try {
        const imagesCount = await Image.countDocuments({ projectId: req.params.id });
        const useImagesPerPart = nextBody.imagesPerPart !== undefined ? nextBody.imagesPerPart : existingProject.imagesPerPart;
        const useSplitRatios = nextBody.splitRatios || existingProject.splitRatios;
        
        if (useImagesPerPart) {
          const numParts = Math.ceil(imagesCount / useImagesPerPart);
          if (numParts < 1) {
            return res.status(400).json({ message: 'Không đủ ảnh để chia theo cấu hình phần.' });
          }
        } else if (useSplitRatios) {
          const parts = buildProjectParts(imagesCount, useSplitRatios);
          if (Array.isArray(parts) && parts.length < useSplitRatios.length) {
            return res.status(400).json({ message: 'Không đủ ảnh để chia theo cấu hình phần.' });
          }
        }
      } catch (err) {
        console.error('Lỗi kiểm tra phần dự án:', err);
      }
    }

    const actualSplitChanged = splitConfigChanged && JSON.stringify({
      splitPercent: nextBody.splitPercent ?? existingProject.splitPercent,
      splitRatios: nextBody.splitRatios ?? existingProject.splitRatios,
      imagesPerPart: nextBody.imagesPerPart !== undefined ? nextBody.imagesPerPart : existingProject.imagesPerPart
    }) !== JSON.stringify({
      splitPercent: existingProject.splitPercent,
      splitRatios: existingProject.splitRatios,
      imagesPerPart: existingProject.imagesPerPart
    });

    const updatedProject = await withProjectWriteLock(projectId, async () => {
      let migration = null;
      if (nextBody.labels !== undefined) {
        const currentProject = await Project.findById(projectId).select('labels segmentationClasses');
        if (!currentProject) throw labelError(404, 'Không tìm thấy dự án!');
        const plan = planLabelUpdate(currentProject.labels, nextBody.labels, labelChange);
        nextBody.labels = plan.nextLabels;
        migration = plan.migration;
        nextBody.segmentationClasses = buildClassCatalog(currentProject.segmentationClasses || [], plan.nextLabels, migration);
      }
      if (migration && actualSplitChanged) {
        throw labelError(400, 'Vui lòng cập nhật nhãn và cách chia dự án trong hai lần riêng biệt.');
      }
      if (actualSplitChanged) {
        // Repartitioning changes the images behind each part number. Revoke old
        // grants before the reassignment; admins explicitly grant the new parts.
        await User.updateMany(
          {
            role: { $ne: 'admin' },
            $or: [
              { allowedProjects: existingProject._id },
              { 'projectPermissions.projectId': existingProject._id }
            ]
          },
          {
            $pull: {
              allowedProjects: existingProject._id,
              projectPermissions: { projectId: existingProject._id }
            }
          }
        );
      }

      const updated = migration
        ? await updateProjectAndEvaluations(projectId, nextBody, migration)
        : await Project.findByIdAndUpdate(
          projectId, nextBody, { new: true }
        ).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');
      if (updated && actualSplitChanged) await reassignProjectImageParts(updated);
      return updated;
    });
    if (!updatedProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });

    res.status(200).json({
      message: 'Cập nhật dự án thành công!',
      project: updatedProject,
      permissionsRevoked: actualSplitChanged
    });
  } catch (error) {
    if (!error.status) console.error("Lỗi sửa project:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Lỗi server' });
  }
});

router.put('/projects/:id/access', verifyAdmin, async (req, res) => {
  try {
    const { userId, partIds } = req.body;
    const projectId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: 'Thiếu userId.' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    }

    await ensureProjectImageParts(project);
    const images = await Image.find({ projectId }).select('_id partId');
    const validPartIds = getProjectPartIds(images, project.splitRatios || [], project.splitPercent || 100, project.imagesPerPart || null);
    const normalizedPartIds = Array.isArray(partIds) ? Array.from(new Set(partIds.map((partId) => String(partId)))) : [];

    if (normalizedPartIds.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một phần của dự án.' });
    }

    const invalidPartId = normalizedPartIds.find((partId) => !validPartIds.includes(partId));
    if (invalidPartId) {
      return res.status(400).json({ message: 'Phần được chọn không hợp lệ với cấu hình dự án hiện tại.' });
    }

    // FIX #2: Gộp 2 lần ghi tách biệt thành 1 atomic aggregation pipeline update để loại trừ race condition
    const projectObjId = new mongoose.Types.ObjectId(projectId);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      [
        {
          $set: {
            allowedProjects: {
              $cond: {
                if: { $in: [projectObjId, { $ifNull: ['$allowedProjects', []] }] },
                then: '$allowedProjects',
                else: { $concatArrays: [{ $ifNull: ['$allowedProjects', []] }, [projectObjId]] }
              }
            },
            projectPermissions: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ['$projectPermissions', []] },
                    cond: { $ne: ['$$this.projectId', projectObjId] }
                  }
                },
                [{ projectId: projectObjId, partIds: normalizedPartIds }]
              ]
            }
          }
        }
      ],
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng!' });
    }

    const refreshedUser = await User.findById(userId)
      .select('-password')
      .populate('allowedProjects', 'name')
      .populate('projectPermissions.projectId', 'name splitPercent splitRatios');
    return res.status(200).json({ message: 'Đã cập nhật quyền theo phần thành công!', user: refreshedUser });
  } catch (error) {
    console.error('Lỗi cập nhật quyền dự án:', error);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật quyền dự án' });
  }
});

router.delete('/projects/:id', verifyAdmin, async (req, res) => {
  try {
    const projectId = req.params.id;
    const result = await withProjectWriteLock(projectId, async () => {
      const project = await Project.findById(projectId);
      if (!project) return { missing: true };

      const imageResult = await deleteProjectImagesInBatches(projectId);
      if (imageResult.failedCount > 0) return imageResult;

      await User.updateMany(
        { allowedProjects: projectId },
        { $pull: { allowedProjects: projectId } }
      );

      await User.updateMany(
        { 'projectPermissions.projectId': projectId },
        { $pull: { projectPermissions: { projectId } } }
      );

      await Project.findByIdAndDelete(projectId);
      return imageResult;
    });

    if (result.missing) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    if (result.failedCount > 0) {
      return res.status(500).json({
        message: `Đã xóa ${result.deletedCount} ảnh, còn ${result.failedCount} ảnh chưa xóa được. Dự án được giữ lại để thử lại.`,
        deletedImages: result.deletedCount,
        failedCount: result.failedCount
      });
    }
    res.status(200).json({
      message: 'Đã xóa dự án, ảnh trên MinIO và dữ liệu liên quan thành công!',
      deletedImages: result.deletedCount
    });
  } catch (error) {
    console.error("Lỗi xóa project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
