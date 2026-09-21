import { joinRequestSchema } from '@bolsa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SettingsToggle } from '../components/settings-toggle';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { useTranslation } from '../i18n';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/store';

/**
 * Spec 11.2: the entry screen. No email, no password, no account — reading the
 * QR Code is the whole sign-up (spec 3).
 */
export function JoinScreen({ eventName }: { eventName: string }): React.JSX.Element {
  const { t } = useTranslation();
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
        throw new Error(parsed.error.issues[0]?.message ?? t('common.networkError'));
      }
      return api.join(eventId ?? '', parsed.data);
    },
    onSuccess: async (participant) => {
      queryClient.setQueryData(['me'], participant);
      await navigate('/');
    },
    onError: (error: Error) => setFieldError(error.message),
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="flex justify-end">
        <SettingsToggle />
      </div>

      <div className="mt-4 flex-1">
        <p className="text-sm tracking-wide text-muted uppercase">{t('join.welcome')}</p>
        <h1 className="mt-1 text-3xl font-bold">{eventName}</h1>
        <p className="mt-3 text-muted">{t('join.intro')}</p>

        <form
          className="mt-8 space-y-5"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            setFieldError(null);
            join.mutate();
          }}
        >
          <Field
            label={t('join.nickname')}
            hint={t('join.nicknameHint')}
            {...(fieldError ? { error: fieldError } : {})}
          >
            <input
              className={inputClass}
              value={nickname}
              onChange={(changeEvent) => setNickname(changeEvent.target.value)}
              placeholder={t('join.nicknamePlaceholder')}
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
              {t('join.adult')}
              <span className="mt-1 block text-muted">{t('join.adultHint')}</span>
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
              {t('join.ranking')}
              <span className="mt-1 block text-muted">{t('join.rankingHint')}</span>
            </span>
          </label>

          {join.isError && join.error instanceof ApiError && (
            <Alert tone="error">{join.error.message}</Alert>
          )}

          <Button type="submit" className="w-full" disabled={join.isPending || !isAdult}>
            {join.isPending ? t('join.submitting') : t('join.submit')}
          </Button>
        </form>
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        {t('join.privacy')}{' '}
        <Link to="/privacidade" className="text-accent underline">
          {t('join.privacyLink')}
        </Link>
        .
      </p>
    </main>
  );
}
