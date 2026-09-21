import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { useCart } from '../lib/store';

/**
 * L7 and spec 12.2: the privacy notice, reachable before anyone hands over a
 * nickname. The organiser can replace the body from the admin panel; what is
 * below is the default, written for the data this product actually collects.
 */
export function PrivacyScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const eventId = useCart((state) => state.eventId);

  const snapshot = useQuery({
    queryKey: ['market', eventId],
    queryFn: () => api.snapshot(eventId ?? ''),
    enabled: Boolean(eventId),
  });

  return (
    <main className="mx-auto max-w-lg px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-10">
      <h1 className="text-2xl font-bold">{t('privacy.title')}</h1>
      <p className="mt-2 text-sm text-muted">{snapshot.data?.eventName ?? 'Bolsa de Bebidas'}</p>

      <Card className="mt-6">
        <h2 className="font-semibold">{t('privacy.collectTitle')}</h2>
        <ul className="mt-2 space-y-2 text-sm text-muted">
          <li>
            <strong className="text-text">{t('privacy.collectName')}</strong>{' '}
            {t('privacy.collectNameBody')}
          </li>
          <li>
            <strong className="text-text">{t('privacy.collectPhone')}</strong>
            {t('privacy.collectPhoneBody')}
          </li>
          <li>
            <strong className="text-text">{t('privacy.collectNif')}</strong>
            {t('privacy.collectNifBody')}
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted">{t('privacy.noTracking')}</p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">{t('privacy.retentionTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('privacy.retentionBody')}</p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">{t('privacy.rightsTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('privacy.rightsBody')}</p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">{t('privacy.hostingTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('privacy.hostingBody')}</p>
      </Card>

      <Link to="/" className="mt-8 inline-block text-accent underline">
        {t('common.back')}
      </Link>
    </main>
  );
}
