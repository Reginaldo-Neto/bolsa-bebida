import { BrowserMultiFormatReader } from '@zxing/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Field, Spinner, inputClass } from '../components/ui';
import { ApiError } from '../lib/api';
import { staffApi, type ScannedVoucher } from '../lib/staff-api';

/**
 * Spec 11.3: the staff app opens straight on the camera and answers in full
 * screen colour. It is used standing up, one-handed, in the dark, by someone
 * with a queue in front of them.
 */
export function StaffApp(): React.JSX.Element {
  const me = useQuery({ queryKey: ['staff-me'], queryFn: staffApi.me, retry: false });

  if (me.isLoading) {
    return <Spinner />;
  }
  if (me.isError) {
    return <StaffLogin role="STAFF" />;
  }

  return <StaffScanner />;
}

/** Shared by the staff and admin apps; admin additionally needs a TOTP code. */
export function StaffLogin({ role }: { role: 'STAFF' | 'ADMIN' }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [eventId, setEventId] = useState(localStorage.getItem('bolsa-event') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

  const login = useMutation({
    mutationFn: () =>
      staffApi.login({
        eventId,
        email,
        password,
        ...(totp ? { totp } : {}),
      }),
    onSuccess: async (staff) => {
      localStorage.setItem('bolsa-event', staff.eventId);
      await queryClient.invalidateQueries();
    },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-bold">{role === 'ADMIN' ? 'Administracao' : 'Bar'}</h1>
      <p className="mt-2 text-sm text-muted">
        {role === 'ADMIN'
          ? 'Entre com a sua conta e o codigo de verificacao.'
          : 'Entre com a conta do ponto de levantamento.'}
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          login.mutate();
        }}
      >
        <Field label="Evento" hint="Identificador do evento.">
          <input
            className={inputClass}
            value={eventId}
            onChange={(changeEvent) => setEventId(changeEvent.target.value)}
            required
          />
        </Field>

        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(changeEvent) => setEmail(changeEvent.target.value)}
            required
          />
        </Field>

        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            required
          />
        </Field>

        {role === 'ADMIN' && (
          <Field label="Codigo de verificacao" hint="Os seis digitos da aplicacao de autenticacao.">
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={6}
              value={totp}
              onChange={(changeEvent) => setTotp(changeEvent.target.value)}
              required
            />
          </Field>
        )}

        {login.isError && (
          <Alert tone="error">
            {login.error instanceof ApiError ? login.error.message : 'Nao foi possivel entrar.'}
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'A entrar…' : 'Entrar'}
        </Button>
      </form>
    </main>
  );
}

type ScanState =
  | { kind: 'scanning' }
  | { kind: 'found'; voucher: ScannedVoucher }
  | { kind: 'error'; message: string };

function StaffScanner(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'scanning' });
  const [manualCode, setManualCode] = useState('');
  const [ageChecked, setAgeChecked] = useState(false);
  const busy = useRef(false);

  const lookUp = useCallback(async (payload: { qr: string } | { shortCode: string }) => {
    if (busy.current) {
      return;
    }
    busy.current = true;

    try {
      const voucher = await staffApi.scan(payload);
      // Spec 11.3: something the hand can feel, because the bar is loud.
      navigator.vibrate?.(60);
      setAgeChecked(false);
      setState({ kind: 'found', voucher });
    } catch (error) {
      navigator.vibrate?.([60, 60, 60]);
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Voucher invalido.',
      });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (state.kind !== 'scanning' || !videoRef.current) {
      return;
    }

    const reader = new BrowserMultiFormatReader();
    let stop: (() => void) | undefined;

    void reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result) {
          void lookUp({ qr: result.getText() });
        }
      })
      .then((controls) => {
        stop = () => controls.stop();
      })
      .catch(() => {
        setState({
          kind: 'error',
          message: 'Sem acesso a camara. Use o codigo curto.',
        });
      });

    return () => stop?.();
  }, [state.kind, lookUp]);

  const redeem = useMutation({
    mutationFn: (input: { voucherId: string; items: { orderItemId: string; qty: number }[] }) =>
      staffApi.redeem(input.voucherId, { items: input.items, ageChecked }),
    onSuccess: (voucher) => {
      navigator.vibrate?.(120);
      setState({ kind: 'found', voucher });
    },
    onError: (error: Error) => {
      navigator.vibrate?.([60, 60, 60]);
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Nao foi possivel entregar.',
      });
    },
  });

  if (state.kind === 'found') {
    const { voucher } = state;
    const pending = voucher.items.filter((item) => item.pendingQty > 0);
    const blocked = voucher.requiresAgeCheck && !ageChecked;

    return (
      <main
        className={`min-h-dvh px-4 py-6 ${
          pending.length === 0
            ? 'bg-up/15'
            : voucher.requiresAgeCheck
              ? 'bg-warning/15'
              : 'bg-up/15'
        }`}
      >
        <p className="text-sm tracking-wide text-muted uppercase">Voucher {voucher.shortCode}</p>
        <h1 className="mt-1 text-3xl font-bold">{voucher.nickname}</h1>

        {pending.length === 0 ? (
          <Alert tone="warning">
            Tudo ja foi levantado
            {voucher.lastRedemption &&
              ` em ${new Date(voucher.lastRedemption.at).toLocaleTimeString('pt-PT')}${
                voucher.lastRedemption.pickupPoint
                  ? ` no ${voucher.lastRedemption.pickupPoint}`
                  : ''
              }`}
            .
          </Alert>
        ) : (
          <>
            {/* L5: nothing alcoholic moves until this is ticked. */}
            {voucher.requiresAgeCheck && (
              <label className="mt-4 flex min-h-16 items-center gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
                <input
                  type="checkbox"
                  className="h-7 w-7 accent-[var(--color-warning)]"
                  checked={ageChecked}
                  onChange={(changeEvent) => setAgeChecked(changeEvent.target.checked)}
                />
                <span className="text-lg font-semibold text-warning">
                  Verificar identificacao (18+)
                </span>
              </label>
            )}

            <ul className="mt-4 space-y-3">
              {pending.map((item) => (
                <li key={item.orderItemId}>
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xl font-semibold">{item.name}</p>
                        <p className="text-sm text-muted">
                          {item.pendingQty} por entregar de {item.qty}
                        </p>
                      </div>
                      <Button
                        disabled={blocked || redeem.isPending}
                        onClick={() =>
                          redeem.mutate({
                            voucherId: voucher.voucherId,
                            items: [{ orderItemId: item.orderItemId, qty: item.pendingQty }],
                          })
                        }
                      >
                        Entregar {item.pendingQty}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>

            <Button
              className="mt-4 w-full py-4 text-lg"
              disabled={blocked || redeem.isPending}
              onClick={() =>
                redeem.mutate({
                  voucherId: voucher.voucherId,
                  items: pending.map((item) => ({
                    orderItemId: item.orderItemId,
                    qty: item.pendingQty,
                  })),
                })
              }
            >
              Entregar tudo
            </Button>
          </>
        )}

        <Button
          variant="secondary"
          className="mt-6 w-full"
          onClick={() => setState({ kind: 'scanning' })}
        >
          Ler outro voucher
        </Button>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="grid min-h-dvh place-items-center bg-down/20 px-4 text-center">
        <div>
          <p className="text-price-lg font-bold text-down">Invalido</p>
          <p className="mt-3 text-lg">{state.message}</p>
          <Button className="mt-8 w-full" onClick={() => setState({ kind: 'scanning' })}>
            Tentar de novo
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-4 py-4">
      <video
        ref={videoRef}
        className="aspect-square w-full rounded-2xl bg-black object-cover"
        muted
        playsInline
      />
      <p className="mt-3 text-center text-muted">Aponte a camara ao codigo do participante</p>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void lookUp({ shortCode: manualCode.toUpperCase() });
        }}
      >
        <input
          className={`${inputClass} tabular uppercase`}
          value={manualCode}
          onChange={(changeEvent) => setManualCode(changeEvent.target.value)}
          placeholder="Codigo curto"
          maxLength={6}
          aria-label="Codigo curto do voucher"
        />
        <Button type="submit" disabled={manualCode.length !== 6}>
          Procurar
        </Button>
      </form>
    </main>
  );
}
