/**
 * Spec 4.3: the last hour of quotes on each product card.
 *
 * Deliberately unlabelled and marked decorative: the numbers that matter (price
 * and the published range) are text right next to it, and a screen reader
 * reading out sixty prices would be useless.
 */
export function Sparkline({
  values,
  direction,
  width = 72,
  height = 24,
}: {
  values: number[];
  direction: 'up' | 'down' | 'flat';
  width?: number;
  height?: number;
}): React.JSX.Element | null {
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = index * step;
      // Inset by 2px so the stroke is not clipped at the edges.
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const stroke =
    direction === 'up'
      ? 'var(--color-up)'
      : direction === 'down'
        ? 'var(--color-down)'
        : 'var(--color-muted)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
