const locks = new Map();

const withProjectWriteLock = async (projectId, operation) => {
  const key = String(projectId);
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
};

module.exports = { withProjectWriteLock };
