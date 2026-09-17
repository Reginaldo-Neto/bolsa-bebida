import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { api, type OrderSummary } from '../lib/api';
import { formatCents } from '../lib/format';

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Por levantar',
  PARTIALLY_REDEEMED: 'Levantamento parcial',
  REDEEMED: 'Levantado',
  REFUNDED: 'Reembolsado',
  PENDING: 'A aguardar pagamento',
  FAILED: 'Pagamento recusado',
  EXPIRED: 'Expirado',
};

function useOrders() {
  return useQuery({ queryKey: ['orders'], queryFn: api.myOrders, staleTime: 5_000 });
}

/** Spec 11.2: the list, with whatever is still redeemable at the top. */
export function VouchersScreen(): React.JSX.Element {
  const orders = useOrders();

  if (orders.isLoading) {
    return <Spinner label="A carregar os vouchers" />;
  }

  const withVoucher = (orders.data ?? []).filter((order) => order.voucher);
  const active = withVoucher.filter(
    (order) => order.voucher?.status === 'ACTIVE' || order.voucher?.status === 'PARTIALLY_REDEEMED',
  );
  const done = withVoucher.filter((order) => !active.includes(order));

  return (
    <>
      <AppHeader title="Os meus vouchers" />
      <main className="mx-auto max-w-lg px-4 pb-4">
        {withVoucher.length === 0 && (
          <p className="py-16 text-center text-muted">Ainda nao tem vouchers.</p>
        )}

        {active.length > 0 && (
          <section className="mt-3">
            <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Por levantar</h2>
            <ul className="space-y-3">
              {active.map((order) => (
                <VoucherRow key={order.id} order={order} />
              ))}
            </ul>
          </section>
        )}

        {done.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Historico</h2>
            <ul className="space-y-3">
              {done.map((order) => (
                <VoucherRow key={order.id} order={order} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function VoucherRow({ order }: { order: OrderSummary }): React.JSX.Element {
  const pending = order.items.reduce((sum, item) => sum + (item.qty - item.redeemedQty), 0);

  return (
    <li>
      <Link to={`/vouchers/${order.voucher?.id}`} className="block">
        <Card className="transition-colors hover:border-accent">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
              </p>
              <p className="mt-1 text-sm text-muted tabular">
                {formatCents(order.totalCents)} · codigo {order.voucher?.shortCode}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                pending > 0 ? 'bg-accent/15 text-accent' : 'bg-raised text-muted'
              }`}
            >
              {STATUS_LABELS[order.voucher?.status ?? order.status] ?? order.status}
            </span>
          </div>
        </Card>
      </Link>
    </li>
  );
}

/**
 * Spec 11.2 and 6.3: the voucher in full screen. The brightness is pushed up
 * and the screen kept awake, because this has to scan at a dark bar.
 */
export function VoucherDetailScreen(): React.JSX.Element {
  const { voucherId } = useParams<{ voucherId: string }>();
  const orders = useOrders();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wakeLockFailed, setWakeLockFailed] = useState(false);

  const order = orders.data?.find((candidate) => candidate.voucher?.id === voucherId);
  const qr = order?.voucher?.qr;

  useEffect(() => {
    if (!qr || !canvasRef.current) {
      return;
    }
    void QRCode.toCanvas(canvasRef.current, qr, {
      width: 320,
      margin: 1,
      // Maximum contrast: the camera has to win against a dark room.
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  }, [qr]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;

    const request = async (): Promise<void> => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        setWakeLockFailed(true);
      }
    };
    void request();

    return () => {
      void lock?.release();
    };
  }, []);

  if (orders.isLoading) {
    return <Spinner label="A carregar o voucher" />;
  }

  if (!order?.voucher) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <Alert tone="error">Voucher nao encontrado.</Alert>
        <Button className="mt-4 w-full" onClick={() => void navigate('/vouchers')}>
          Ver os meus vouchers
        </Button>
      </main>
    );
  }

  const pendingItems = order.items.filter((item) => item.qty > item.redeemedQty);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="flex-1">
        <div className="mx-auto mt-2 w-fit rounded-3xl bg-white p-4">
          <canvas ref={canvasRef} aria-label="Codigo QR do voucher" />
        </div>

        <p className="mt-4 text-center text-sm text-muted">Se o QR nao ler, diga este codigo</p>
        <p className="text-center text-price-lg font-bold tracking-[0.2em] tabular">
          {order.voucher.shortCode}
        </p>

        {wakeLockFailed && (
          <p className="mt-3 text-center text-xs text-muted">
            Suba o brilho do ecra para o codigo ler melhor.
          </p>
        )}

        <Card className="mt-6">
          <h2 className="text-sm tracking-wide text-muted uppercase">Por levantar</h2>
          <ul className="mt-2 space-y-1">
            {pendingItems.length === 0 ? (
              <li className="text-muted">Tudo levantado.</li>
            ) : (
              pendingItems.map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span>{item.name}</span>
                  <span className="tabular">
                    {item.qty - item.redeemedQty} de {item.qty}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>

      <Button
        variant="secondary"
        className="mt-6 w-full"
        onClick={() => void navigate('/vouchers')}
      >
        Fechar
      </Button>
    </main>
  );
}
