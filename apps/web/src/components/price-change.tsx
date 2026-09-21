import { useTranslation } from '../i18n';
import { directionOf, formatChange } from '../lib/format';

const STYLES = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-muted',
} as const;

/** Spec 11.1: the arrow is always drawn, so colour is never the only signal. */
const ARROWS = { up: '▲', down: '▼', flat: '—' } as const;

export function PriceChange({
  ratio,
  className = '',
}: {
  ratio: number;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const direction = directionOf(ratio);

  const spoken = {
    up: t('price.up'),
    down: t('price.down'),
    flat: t('price.flat'),
  }[direction];

  return (
    <span
      className={`inline-flex items-center gap-1 tabular ${STYLES[direction]} ${className}`}
      // "Change", never a reduction (L3).
      aria-label={t('price.aria', { change: formatChange(ratio), direction: spoken })}
    >
      <span aria-hidden="true">{ARROWS[direction]}</span>
      <span aria-hidden="true">{formatChange(ratio)}</span>
    </span>
  );
}
