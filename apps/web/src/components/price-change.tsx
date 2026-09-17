import { directionOf, formatChange } from '../lib/format';

const STYLES = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-muted',
} as const;

/** Spec 11.1: the arrow is always drawn, so colour is never the only signal. */
const ARROWS = { up: '▲', down: '▼', flat: '—' } as const;

const LABELS = {
  up: 'a subir',
  down: 'a descer',
  flat: 'sem variacao',
} as const;

export function PriceChange({
  ratio,
  className = '',
}: {
  ratio: number;
  className?: string;
}): React.JSX.Element {
  const direction = directionOf(ratio);

  return (
    <span
      className={`inline-flex items-center gap-1 tabular ${STYLES[direction]} ${className}`}
      // "Variacao", never a reduction (L3).
      aria-label={`Variacao ${formatChange(ratio)}, ${LABELS[direction]}`}
    >
      <span aria-hidden="true">{ARROWS[direction]}</span>
      <span aria-hidden="true">{formatChange(ratio)}</span>
    </span>
  );
}
