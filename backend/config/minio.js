const minio = require('minio');

const normalizeMinioEndpoint = (value) => {
  const raw = String(value || 'minio').trim();
  try {
    const parsedUrl = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`);
    const hostname = parsedUrl.hostname || 'minio';
    const port = parsedUrl.port || '';
    return {
      endPoint: hostname,
      port: port ? Number(port) : undefined,
      useSSL: parsedUrl.protocol === 'https:'
    };
  } catch (error) {
    const hostOnly = raw.split('/')[0].split(':')[0] || 'minio';
    return {
      endPoint: hostOnly,
      port: undefined,
      useSSL: false
    };
  }
};

const endpointConfig = normalizeMinioEndpoint(process.env.MINIO_ENDPOINT || 'minio');

const MINIO_ENDPOINT = endpointConfig.endPoint;
const MINIO_PORT = Number(process.env.MINIO_PORT || endpointConfig.port || 9000);
const MINIO_ACCESS_KEY = String(process.env.MINIO_ACCESS_KEY || 'admin').trim();
const MINIO_SECRET_KEY = String(process.env.MINIO_SECRET_KEY || 'admin123').trim();
const MINIO_USE_SSL = String(process.env.MINIO_USE_SSL || process.env.MINIO_SECURE || endpointConfig.useSSL || false).toLowerCase() === 'true' || Boolean(endpointConfig.useSSL);
const BUCKET_NAME = String(process.env.MINIO_BUCKET_NAME || 'originals').trim();

const minioClient = new minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

module.exports = {
  minioClient,
  BUCKET_NAME,
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_USE_SSL
};
