import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Spinner } from '../components/ui';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { useFormatters } from '../lib/format';

/**
 * Spec 11.2: waiting for MB WAY.
 *
 * The socket push is the fast path; the poll is the safety net, because venue
 * wifi drops and a participant staring at a spinner that never resolves is the
 * failure they will remember.
 */
export function PaymentScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: api.myOrders,
    refetchInterval: (query) => {
      const order = query.state.data?.find((candidate) => candidate.id === orderId);
      return order && order.status !== 'PENDING' ? false : 3_000;
    },
  });

  const order = orders.data?.find((candidate) => candidate.id === orderId);

  useEffect(() => {
    if (order?.voucher) {
      void navigate(`/vouchers/${order.voucher.id}`, { replace: true });
    }
  }, [order, navigate]);

  if (orders.isLoading || !order) {
    return <Spinner label={t('payment.confirming')} />;
  }

  if (order.status === 'FAILED' || order.status === 'EXPIRED') {
    return (
      <>
        <AppHeader title={t('checkout.title')} />
        <main className="mx-auto max-w-lg px-4 py-6">
          <Alert tone="error">
            {order.status === 'EXPIRED' ? t('payment.expired') : t('payment.refused')}
          </Alert>
          <p className="mt-3 text-sm text-muted">{t('payment.released')}</p>
          <Button className="mt-6 w-full" onClick={() => void navigate('/')}>
            {t('common.backToMarket')}
          </Button>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader title={t('checkout.title')} />
      <main className="mx-auto max-w-lg px-4 py-10 text-center">
        <div
          aria-hidden="true"
          className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-line border-t-accent"
        />
        <h2 className="mt-6 text-xl font-semibold">{t('payment.confirmInApp')}</h2>
        <p className="mt-2 text-muted">
          {t('payment.sentRequest', { total: format.money(order.totalCents) })}
        </p>

        <ul className="mt-6 space-y-1 text-sm text-muted">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.qty}× {item.name}
            </li>
          ))}
        </ul>

        <Button variant="ghost" className="mt-8 w-full" onClick={() => void navigate('/')}>
          {t('payment.keepBrowsing')}
        </Button>

        {import.meta.env.DEV && order.paymentRef && (
          <DevPaymentControls paymentRef={order.paymentRef} />
        )}
      </main>
    </>
  );
}

/**
 * Development only: there is no MB WAY application to confirm in, so this does
 * what the gateway's webhook would do. The API refuses these routes outside
 * development, and this block is stripped from a production build.
 */
function DevPaymentControls({ paymentRef }: { paymentRef: string }): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const simulate = useMutation({
    mutationFn: (status: 'PAID' | 'FAILED') => api.simulatePayment(paymentRef, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  return (
    <section className="mt-10 rounded-xl border border-dashed border-line p-4 text-left">
      <p className="text-xs tracking-wide text-muted uppercase">{t('payment.devOnly')}</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={simulate.isPending}
          onClick={() => simulate.mutate('PAID')}
        >
          {t('payment.devConfirm')}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={simulate.isPending}
          onClick={() => simulate.mutate('FAILED')}
        >
          {t('payment.devRefuse')}
        </Button>
      </div>
    </section>
  );
}
