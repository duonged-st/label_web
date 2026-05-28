const hashString = (input) => {
  let hash = 2166136261;
  const text = String(input || '');

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const shuffleWithSeed = (items, seed, getItemKey = (item, index) => String(item?._id || item?.id || index)) => {
  const list = Array.isArray(items) ? [...items] : [];
  const normalizedSeed = String(seed || 'default-seed');

  return list
    .map((item, index) => ({
      item,
      key: getItemKey(item, index),
      score: hashString(`${normalizedSeed}:${getItemKey(item, index)}`)
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return String(left.key).localeCompare(String(right.key));
    })
    .map((entry) => entry.item);
};