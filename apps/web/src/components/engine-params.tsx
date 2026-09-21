import { DEFAULT_ENGINE_PARAMS } from '@bolsa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
const DIALS = [
  {
    key: 'tickSeconds',
    label: 'Intervalo entre atualizacoes',
    hint: 'De quanto em quanto tempo as cotacoes sao recalculadas, em segundos.',
    min: 30,
    max: 600,
    step: 10,
  },
  {
    key: 'demandSensitivity',
    label: 'Resposta a procura',
    hint: 'Quanto o preco reage a uma bebida vender acima do esperado. Mais alto, mercado mais nervoso.',
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'meanReversion',
    label: 'Regresso ao preco base',
    hint: 'Com que forca um preco afastado volta ao base quando as vendas acalmam.',
    min: 0,
    max: 0.3,
    step: 0.01,
  },
  {
    key: 'stockPressure',
    label: 'Pressao de stock baixo',
    hint: 'Quanto o preco sobe quando uma bebida esta quase a acabar.',
    min: 0,
    max: 0.3,
    step: 0.01,
  },
  {
    key: 'maxStepPct',
    label: 'Variacao maxima por atualizacao',
    hint: 'O salto maior que um preco pode dar de uma vez. Evita surpresas.',
    min: 0.01,
    max: 0.3,
    step: 0.01,
  },
] as const;

export function EngineParams({
  params,
  onDone,
}: {
  params: Record<string, number | boolean>;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, number | boolean>>({
    ...DEFAULT_ENGINE_PARAMS,
    ...params,
  });

  const save = useMutation({
    mutationFn: () => adminApi.updateEngineParams(draft),
    onSuccess: async () => {
      onDone('Parametros guardados. Entram em vigor na proxima atualizacao.');
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => onDone(error.message),
  });

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Motor de precos</h2>

      <div className="space-y-5 rounded-xl border border-line bg-surface p-4">
        {DIALS.map((dial) => {
          const value = Number(draft[dial.key] ?? 0);
          return (
            <label key={dial.key} className="block">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{dial.label}</span>
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
              <span className="mt-1 block text-xs text-muted">{dial.hint}</span>
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
            Manter o preco medio de cada grupo perto do base
            <span className="mt-1 block text-xs text-muted">
              Com isto ligado, quando uma bebida sobe as alternativas do mesmo grupo descem, e a
              receita nao depende do que a noite calhar a correr. Desligado, os precos movem-se
              livremente e a receita pode variar bastante.
            </span>
          </span>
        </label>

        <Alert>
          As alteracoes so entram em vigor na atualizacao seguinte. Calibre estes valores no
          simulador antes da festa, nao durante.
        </Alert>

        <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'A guardar…' : 'Guardar parametros'}
        </Button>
      </div>
    </section>
  );
}
