import { AppHeader } from '../components/chrome';
import { Card } from '../components/ui';
import { useTranslation } from '../i18n';

/** Spec 11.2: how the market works, in the participant's own words. */
export function HelpScreen(): React.JSX.Element {
  const { t } = useTranslation();

  const sections = [
    { title: t('help.movesTitle'), body: t('help.movesBody') },
    { title: t('help.capTitle'), body: t('help.capBody') },
    { title: t('help.lockTitle'), body: t('help.lockBody') },
    { title: t('help.pickupTitle'), body: t('help.pickupBody') },
    { title: t('help.responsibleTitle'), body: t('help.responsibleBody') },
  ];

  return (
    <>
      <AppHeader title={t('help.title')} />
      <main className="mx-auto max-w-lg space-y-4 px-4 pb-6">
        {sections.map((section, index) => (
          <Card key={section.title} className={index === 0 ? 'mt-3' : ''}>
            <h2 className="font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm text-muted">{section.body}</p>
          </Card>
        ))}
      </main>
    </>
  );
}

export function NotFoundScreen(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-price-lg font-bold">404</p>
        <p className="mt-2 text-muted">{t('common.notFound')}</p>
        <a href="/" className="mt-6 inline-block text-accent underline">
          {t('common.backToMarket')}
        </a>
      </div>
    </main>
  );
}
