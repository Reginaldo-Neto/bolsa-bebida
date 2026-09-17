import { joinRequestSchema } from '@bolsa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/store';

/**
 * Spec 11.2: the entry screen. No email, no password, no account — reading the
 * QR Code is the whole sign-up (spec 3).
 */
export function JoinScreen({ eventName }: { eventName: string }): React.JSX.Element {
  const eventId = useCart((state) => state.eventId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [nickname, setNickname] = useState('');
  const [isAdult, setIsAdult] = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: async () => {
      const parsed = joinRequestSchema.safeParse({ nickname, isAdult, leaderboardOptIn });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Dados invalidos');
      }
      return api.join(eventId ?? '', parsed.data);
    },
    onSuccess: async (participant) => {
      queryClient.setQueryData(['me'], participant);
      await navigate('/');
    },
    onError: (error: Error) => {
      setFieldError(error.message);
    },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="flex-1">
        <p className="text-sm tracking-wide text-muted uppercase">Bem-vindo a</p>
        <h1 className="mt-1 text-3xl font-bold">{eventName}</h1>
        <p className="mt-3 text-muted">
          Os precos das bebidas variam ao vivo conforme a procura, sempre dentro de um intervalo
          minimo e maximo afixado para cada bebida.
        </p>

        <form
          className="mt-8 space-y-5"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            setFieldError(null);
            join.mutate();
          }}
        >
          <Field
            label="Como quer ser tratado?"
            hint="Este nome aparece no voucher e, se quiser, no ranking."
            {...(fieldError ? { error: fieldError } : {})}
          >
            <input
              className={inputClass}
              value={nickname}
              onChange={(changeEvent) => setNickname(changeEvent.target.value)}
              placeholder="O seu nome ou alcunha"
              autoComplete="nickname"
              maxLength={20}
              required
            />
          </Field>

          {/* L5: no alcohol without this declaration. */}
          <label className="flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface p-3">
            <input
              type="checkbox"
              className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-accent)]"
              checked={isAdult}
              onChange={(changeEvent) => setIsAdult(changeEvent.target.checked)}
              required
            />
            <span className="text-sm">
              Declaro que tenho 18 anos ou mais.
              <span className="mt-1 block text-muted">
                A venda de bebidas alcoolicas a menores de 18 anos e proibida. O pessoal do bar pode
                pedir identificacao no levantamento.
              </span>
            </span>
          </label>

          {/* L7: appearing in the ranking is separate, explicit consent. */}
          <label className="flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface p-3">
            <input
              type="checkbox"
              className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-accent)]"
              checked={leaderboardOptIn}
              onChange={(changeEvent) => setLeaderboardOptIn(changeEvent.target.checked)}
            />
            <span className="text-sm">
              Quero aparecer no ranking Melhor Trader.
              <span className="mt-1 block text-muted">
                O ranking mede a qualidade das compras, nunca a quantidade. Pode sair quando quiser.
              </span>
            </span>
          </label>

          {join.isError && join.error instanceof ApiError && (
            <Alert tone="error">{join.error.message}</Alert>
          )}

          <Button type="submit" className="w-full" disabled={join.isPending || !isAdult}>
            {join.isPending ? 'A entrar…' : 'Entrar no mercado'}
          </Button>
        </form>
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        Ao entrar aceita os termos e a politica de privacidade. Recolhemos apenas o nome que
        escolher e, no pagamento, o numero de telemovel — guardado apenas em forma cifrada.
      </p>
    </main>
  );
}
