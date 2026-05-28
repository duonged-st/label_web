export function getLabelStyleByPosition(position, total) {
  if (position < 0 || total <= 0) return null;

  const maxFillOpacity = 0.24;
  const minFillOpacity = 0.08;
  const fillOpacity = total <= 1
    ? maxFillOpacity
    : maxFillOpacity - ((maxFillOpacity - minFillOpacity) * position) / (total - 1);

  const maxBorderOpacity = 0.55;
  const minBorderOpacity = 0.28;
  const borderOpacity = total <= 1
    ? maxBorderOpacity
    : maxBorderOpacity - ((maxBorderOpacity - minBorderOpacity) * position) / (total - 1);

  return {
    backgroundColor: `rgba(37, 99, 235, ${fillOpacity.toFixed(3)})`,
    borderColor: `rgba(37, 99, 235, ${borderOpacity.toFixed(3)})`,
    color: '#1d4ed8'
  };
}