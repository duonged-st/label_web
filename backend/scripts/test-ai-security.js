const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-thirty-two-characters';
process.env.AI_SERVICE_TOKEN = 'test-ai-service-token-with-more-than-thirty-two-characters';
process.env.AI_SERVICE_URL = 'http://ai-service-test:5001';

const User = require('../models/User');
const AiModel = require('../models/AiModel');
const Image = require('../models/Image');
const Project = require('../models/Project');
const { jwtSecret } = require('../config/security');

const users = {
  admin: { _id: 'admin', role: 'admin', username: 'admin' },
  assigned: {
    _id: 'assigned', role: 'user', username: 'assigned',
    allowedProjects: ['project-1'],
    projectPermissions: [{ projectId: 'project-1', partIds: ['1'] }]
  },
  unassigned: {
    _id: 'unassigned', role: 'user', username: 'unassigned',
    allowedProjects: ['project-1'],
    projectPermissions: [{ projectId: 'project-1', partIds: [] }]
  }
};
const images = {
  'image-1': { _id: 'image-1', projectId: 'project-1', partId: '1', storageKey: 'stored-image-1.jpg' },
  'image-2': { _id: 'image-2', projectId: 'project-1', partId: '2', storageKey: 'stored-image-2.jpg' },
  'image-3': { _id: 'image-3', projectId: 'project-2', partId: '1', storageKey: 'stored-image-3.jpg' },
  'legacy-1': { _id: 'legacy-1', projectId: 'project-1', uploadDate: new Date('2026-01-02'), storageKey: 'legacy-1.jpg' },
  'legacy-2': { _id: 'legacy-2', projectId: 'project-1', uploadDate: new Date('2026-01-01'), storageKey: 'legacy-2.jpg' }
};
const project = {
  _id: 'project-1', aiModelId: 'model-1', labels: ['dog', 'cat'], splitRatios: [50, 50]
};

User.findById = (id) => ({ select: async () => users[String(id)] || null });
AiModel.findById = async (id) => String(id) === 'model-1'
  ? { _id: 'model-1', minioPath: 'stored-model.onnx' }
  : null;
Image.findById = async (id) => images[String(id)] || null;
Image.find = () => ({ select: async () => [images['legacy-1'], images['legacy-2']] });
Project.findOne = (query) => ({
  select: async () => String(query._id) === 'project-1' && String(query.aiModelId) === 'model-1'
    ? project
    : null
});
Project.find = () => ({ select: async () => [project] });

const aiRequests = [];
global.fetch = async (url, options) => {
  aiRequests.push({ url, options });
  return {
    ok: true, status: 200,
    json: async () => url.endsWith('/health')
      ? { models: { 'stored-model.onnx': {} }, active_slots: 1 }
      : { predictions: [{ label: 'dog', confidence: 0.9 }] }
  };
};

const app = express();
app.use(express.json());
app.use('/api', require('../controllers/aiModel'));

const token = (userId) => jwt.sign({ userId }, jwtSecret);

async function main() {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = require('node:http');

  const request = (method, endpoint, userId, body) => new Promise((resolve, reject) => {
    const encoded = body === undefined ? '' : JSON.stringify(body);
    const url = new URL(endpoint, base);
    const req = nativeFetch.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token(userId)}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(encoded)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(encoded);
  });

  try {
    assert.equal((await request('POST', '/api/ai-models/model-1/load', 'assigned')).status, 403);
    assert.equal((await request('POST', '/api/ai-models/model-1/unload', 'assigned')).status, 403);
    assert.equal(aiRequests.length, 0);

    assert.equal((await request('POST', '/api/ai-models/model-1/load', 'admin')).status, 200);
    assert.equal((await request('POST', '/api/ai-models/model-1/unload', 'admin')).status, 200);
    assert.equal(aiRequests.length, 2);
    assert(aiRequests.every(({ options }) => options.headers['X-AI-Service-Token'] === process.env.AI_SERVICE_TOKEN));
    aiRequests.length = 0;

    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageId: 'image-2'
    })).status, 403);
    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageId: 'image-3'
    })).status, 403);
    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'unassigned', {
      imageId: 'image-1'
    })).status, 403);
    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageUrl: 'http://127.0.0.1:9000/private'
    })).status, 400);
    assert.equal(aiRequests.length, 0);

    const allowed = await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageId: 'image-1', classNames: ['attacker'], imageUrl: 'http://127.0.0.1/private'
    });
    assert.equal(allowed.status, 200);
    assert.equal(aiRequests.length, 1);
    const sent = JSON.parse(aiRequests[0].options.body);
    assert.deepEqual(sent, {
      minio_path: 'stored-model.onnx',
      image_key: 'stored-image-1.jpg',
      class_names: ['dog', 'cat']
    });
    assert.equal(aiRequests[0].options.headers['X-AI-Service-Token'], process.env.AI_SERVICE_TOKEN);

    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageId: 'legacy-1'
    })).status, 200);
    assert.equal((await request('POST', '/api/ai-models/model-1/predict', 'assigned', {
      imageId: 'legacy-2'
    })).status, 403);

    assert.equal((await request('GET', '/api/ai-models/model-1/status', 'unassigned')).status, 403);
    assert.equal((await request('GET', '/api/ai-models/model-1/status', 'assigned')).status, 200);
    assert.equal((await request('GET', '/api/ai-models', 'assigned')).status, 403);
    console.log('AI authorization and trusted-image contract passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
