import { BrowserMultiFormatReader } from '@zxing/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsToggle } from '../components/settings-toggle';
import { Alert, Button, Card, Field, Spinner, inputClass } from '../components/ui';
import { useTranslation } from '../i18n';
import { ApiError } from '../lib/api';
import { useFormatters } from '../lib/format';
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
  const { t } = useTranslation();
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          {role === 'ADMIN' ? t('admin.title') : t('staff.title')}
        </h1>
        <SettingsToggle compact />
      </div>
      <p className="mt-2 text-sm text-muted">
        {role === 'ADMIN' ? t('admin.intro') : t('staff.intro')}
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          login.mutate();
        }}
      >
        <Field label={t('staff.event')} hint={t('staff.eventHint')}>
          <input
            className={inputClass}
            value={eventId}
            onChange={(changeEvent) => setEventId(changeEvent.target.value)}
            required
          />
        </Field>

        <Field label={t('staff.email')}>
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(changeEvent) => setEmail(changeEvent.target.value)}
            required
          />
        </Field>

        <Field label={t('staff.password')}>
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
          <Field label={t('admin.totp')} hint={t('admin.totpHint')}>
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
            {login.error instanceof ApiError ? login.error.message : t('staff.signInFailed')}
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? t('staff.signingIn') : t('staff.signIn')}
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
  const { t } = useTranslation();
  const format = useFormatters();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'scanning' });
  const [manualCode, setManualCode] = useState('');
  const [phone, setPhone] = useState('');
  const [ageChecked, setAgeChecked] = useState(false);
  const busy = useRef(false);

  /** Spec 6.4: the participant lost their session but is standing right here. */
  const lookUpByPhone = useCallback(
    async (value: string) => {
      try {
        const vouchers = await staffApi.findByPhone(value);
        if (vouchers.length === 0) {
          setState({ kind: 'error', message: t('staff.noVouchersForPhone') });
          return;
        }
        navigator.vibrate?.(60);
        setAgeChecked(false);
        // More than one is rare; the rest are reachable by their short codes.
        setState({ kind: 'found', voucher: vouchers[0] as ScannedVoucher });
      } catch (error) {
        setState({
          kind: 'error',
          message: error instanceof ApiError ? error.message : t('staff.lookupFailed'),
        });
      }
    },
    [t],
  );

  const lookUp = useCallback(
    async (payload: { qr: string } | { shortCode: string }) => {
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
          message: error instanceof ApiError ? error.message : t('staff.invalidVoucher'),
        });
      } finally {
        busy.current = false;
      }
    },
    [t],
  );

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
        setState({ kind: 'error', message: t('staff.noCamera') });
      });

    return () => stop?.();
  }, [state.kind, lookUp, t]);

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
        message: error instanceof ApiError ? error.message : t('staff.deliverFailed'),
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
        <p className="text-sm tracking-wide text-muted uppercase">
          {t('staff.voucher', { code: voucher.shortCode })}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{voucher.nickname}</h1>

        {pending.length === 0 ? (
          <Alert tone="warning">
            {voucher.lastRedemption
              ? t('staff.allRedeemedAt', {
                  when: format.time(voucher.lastRedemption.at),
                  place: voucher.lastRedemption.pickupPoint
                    ? t('staff.atPlace', { place: voucher.lastRedemption.pickupPoint })
                    : '',
                })
              : t('staff.allRedeemed')}
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
                <span className="text-lg font-semibold text-warning">{t('staff.checkAge')}</span>
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
                          {t('staff.pendingOf', { pending: item.pendingQty, qty: item.qty })}
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
                        {t('staff.deliver', { count: item.pendingQty })}
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
              {t('staff.deliverAll')}
            </Button>
          </>
        )}

        <Button
          variant="secondary"
          className="mt-6 w-full"
          onClick={() => setState({ kind: 'scanning' })}
        >
          {t('staff.scanAnother')}
        </Button>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="grid min-h-dvh place-items-center bg-down/20 px-4 text-center">
        <div>
          <p className="text-price-lg font-bold text-down">{t('staff.invalid')}</p>
          <p className="mt-3 text-lg">{state.message}</p>
          <Button className="mt-8 w-full" onClick={() => setState({ kind: 'scanning' })}>
            {t('staff.tryAgain')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-4 py-4">
      <div className="mb-3 flex justify-end">
        <SettingsToggle compact />
      </div>

      <video
        ref={videoRef}
        className="aspect-square w-full rounded-2xl bg-black object-cover"
        muted
        playsInline
      />
      <p className="mt-3 text-center text-muted">{t('staff.pointCamera')}</p>

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
          placeholder={t('staff.shortCode')}
          maxLength={6}
          aria-label={t('staff.shortCodeAria')}
        />
        <Button type="submit" disabled={manualCode.length !== 6}>
          {t('common.search')}
        </Button>
      </form>

      {/* Spec 6.4: someone who closed the app and has nothing to show. */}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void lookUpByPhone(phone);
        }}
      >
        <input
          className={`${inputClass} tabular`}
          value={phone}
          onChange={(changeEvent) => setPhone(changeEvent.target.value)}
          type="tel"
          inputMode="numeric"
          placeholder={t('staff.phone')}
          aria-label={t('staff.phoneAria')}
        />
        <Button type="submit" variant="secondary" disabled={phone.replace(/\D/g, '').length < 9}>
          {t('common.search')}
        </Button>
      </form>
      <p className="mt-2 text-center text-xs text-muted">{t('staff.phoneHint')}</p>
    </main>
  );
}
