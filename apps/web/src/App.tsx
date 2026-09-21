import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { BottomNav } from './components/chrome';
import { Spinner } from './components/ui';
import { useTranslation } from './i18n';
import { ApiError, api } from './lib/api';
import { applySettings, themeForPath, useSettings } from './lib/settings';
import { useCart } from './lib/store';
import { AdminApp } from './routes/admin';
import { CartScreen } from './routes/cart';
import { CheckoutScreen } from './routes/checkout';
import { JoinScreen } from './routes/join';
import { MarketScreen } from './routes/market';
import { PaymentScreen } from './routes/payment';
import { PricesScreen } from './routes/prices';
import { PrivacyScreen } from './routes/privacy';
import { RankingScreen } from './routes/ranking';
import { PublicScreen } from './routes/screen';
import { StaffApp } from './routes/staff';
import { HelpScreen, NotFoundScreen } from './routes/static-pages';
import { VoucherDetailScreen, VouchersScreen } from './routes/vouchers';

/**
 * The theme and the language live on <html>: the CSS custom properties read
 * data-theme, and a screen reader reads lang. Both have to be written before
 * anything is painted, which is why this sits above every route.
 */
function useAppliedSettings(): void {
  const theme = useSettings((state) => state.theme);
  const locale = useSettings((state) => state.locale);
  const { pathname } = useLocation();

  useEffect(() => {
    applySettings(themeForPath(pathname, theme), locale);
  }, [pathname, theme, locale]);
}

/** The QR Code at the venue points here; it only records which event this is. */
function EnterEvent(): React.JSX.Element {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const setEventId = useCart((state) => state.setEventId);
  const navigate = useNavigate();

  useEffect(() => {
    if (eventId) {
      setEventId(eventId);
    }
    void navigate('/', { replace: true });
  }, [eventId, setEventId, navigate]);

  return <Spinner label={t('join.submitting')} />;
}

/**
 * Everything behind the session. There is no login: either the cookie from
 * joining is there, or the participant sees the entry screen again.
 */
function ParticipantArea(): React.JSX.Element {
  const { t } = useTranslation();
  const eventId = useCart((state) => state.eventId);

  const snapshot = useQuery({
    queryKey: ['market', eventId],
    queryFn: () => api.snapshot(eventId ?? ''),
    enabled: Boolean(eventId),
  });

  const me = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: Boolean(eventId),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 2,
  });

  if (!eventId) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">{t('join.needQr')}</h1>
          <p className="mt-3 text-muted">{t('join.needQrHint')}</p>
        </div>
      </main>
    );
  }

  if (me.isLoading || snapshot.isLoading) {
    return <Spinner />;
  }

  if (me.isError) {
    return <JoinScreen eventName={snapshot.data?.eventName ?? 'Bolsa de Bebidas'} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}

export function App(): React.JSX.Element {
  useAppliedSettings();

  return (
    <Routes>
      <Route path="/e/:eventId" element={<EnterEvent />} />

      {/* Public, sessionless surfaces. */}
      <Route path="/screen" element={<PublicScreen />} />
      <Route path="/prices" element={<PricesScreen />} />
      {/* L7: readable before anyone hands over a nickname. */}
      <Route path="/privacidade" element={<PrivacyScreen />} />

      {/* Behind a staff session, not a participant one. */}
      <Route path="/staff" element={<StaffApp />} />
      <Route path="/admin" element={<AdminApp />} />

      <Route element={<ParticipantArea />}>
        <Route index element={<MarketScreen />} />
        <Route path="/carrinho" element={<CartScreen />} />
        <Route path="/checkout" element={<CheckoutScreen />} />
        <Route path="/pagamento/:orderId" element={<PaymentScreen />} />
        <Route path="/vouchers" element={<VouchersScreen />} />
        <Route path="/vouchers/:voucherId" element={<VoucherDetailScreen />} />
        <Route path="/ranking" element={<RankingScreen />} />
        <Route path="/ajuda" element={<HelpScreen />} />
      </Route>

      <Route path="/404" element={<NotFoundScreen />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
