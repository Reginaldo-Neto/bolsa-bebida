import { DEFAULT_ENGINE_PARAMS } from '@bolsa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation, type TranslationKey } from '../i18n';
import { adminApi } from '../lib/staff-api';
import { Alert, Button } from './ui';

/**
 * Spec 4.7 and 5.2: the engine's dials, adjustable during the party with
 * effect on the next tick.
 *
 * Each one says what it does in the organiser's terms rather than by its Greek
 * letter, because the person reaching for these at one in the morning is
 * deciding whether the market feels right, not reading the spec.
 */
const DIALS: {
  key: string;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  min: number;
  max: number;
  step: number;
}[] = [
  {
    key: 'tickSeconds',
    labelKey: 'engine.tickSeconds',
    hintKey: 'engine.tickSecondsHint',
    min: 30,
    max: 600,
    step: 10,
  },
  {
    key: 'demandSensitivity',
    labelKey: 'engine.demand',
    hintKey: 'engine.demandHint',
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'meanReversion',
    labelKey: 'engine.reversion',
    hintKey: 'engine.reversionHint',
    min: 0,
    max: 0.3,
    step: 0.01,
  },
  {
    key: 'stockPressure',
    labelKey: 'engine.stock',
    hintKey: 'engine.stockHint',
    min: 0,
    max: 0.3,
    step: 0.01,
  },
  {
    key: 'maxStepPct',
    labelKey: 'engine.maxStep',
    hintKey: 'engine.maxStepHint',
    min: 0.01,
    max: 0.3,
    step: 0.01,
  },
];

export function EngineParams({
  params,
  onDone,
}: {
  params: Record<string, number | boolean>;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, number | boolean>>({
    ...DEFAULT_ENGINE_PARAMS,
    ...params,
  });

  const save = useMutation({
    mutationFn: () => adminApi.updateEngineParams(draft),
    onSuccess: async () => {
      onDone(t('engine.saved'));
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => onDone(error.message),
  });

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">{t('engine.title')}</h2>

      <div className="space-y-5 rounded-xl border border-line bg-surface p-4">
        {DIALS.map((dial) => {
          const value = Number(draft[dial.key] ?? 0);
          return (
            <label key={dial.key} className="block">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{t(dial.labelKey)}</span>
                <span className="tabular text-accent">
                  {dial.key === 'tickSeconds' ? `${value}s` : value.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="mt-2 w-full accent-[var(--color-accent)]"
                min={dial.min}
                max={dial.max}
                step={dial.step}
                value={value}
                onChange={(changeEvent) =>
                  setDraft({ ...draft, [dial.key]: Number(changeEvent.target.value) })
                }
              />
              <span className="mt-1 block text-xs text-muted">{t(dial.hintKey)}</span>
            </label>
          );
        })}

        <label className="flex min-h-12 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-accent)]"
            checked={Boolean(draft.renormalize)}
            onChange={(changeEvent) =>
              setDraft({ ...draft, renormalize: changeEvent.target.checked })
            }
          />
          <span className="text-sm">
            {t('engine.renormalize')}
            <span className="mt-1 block text-xs text-muted">{t('engine.renormalizeHint')}</span>
          </span>
        </label>

        <Alert>{t('engine.effectNote')}</Alert>

        <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('engine.saving') : t('engine.save')}
        </Button>
      </div>
    </section>
  );
}
