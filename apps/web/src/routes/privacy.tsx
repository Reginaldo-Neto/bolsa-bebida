import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { api } from '../lib/api';
import { useCart } from '../lib/store';

/**
 * L7 and spec 12.2: the privacy notice, reachable before anyone hands over a
 * nickname. The organiser can replace the body from the admin panel; what is
 * below is the default, written for the data this product actually collects.
 */
export function PrivacyScreen(): React.JSX.Element {
  const eventId = useCart((state) => state.eventId);

  const snapshot = useQuery({
    queryKey: ['market', eventId],
    queryFn: () => api.snapshot(eventId ?? ''),
    enabled: Boolean(eventId),
  });

  return (
    <main className="mx-auto max-w-lg px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-10">
      <h1 className="text-2xl font-bold">Privacidade</h1>
      <p className="mt-2 text-sm text-muted">{snapshot.data?.eventName ?? 'Bolsa de Bebidas'}</p>

      <Card className="mt-6">
        <h2 className="font-semibold">O que recolhemos</h2>
        <ul className="mt-2 space-y-2 text-sm text-muted">
          <li>
            <strong className="text-text">O nome que escolher.</strong> Aparece no seu voucher e, se
            aceitar, no ranking. Pode ser uma alcunha.
          </li>
          <li>
            <strong className="text-text">O numero de telemovel</strong>, apenas no momento do
            pagamento e apenas para o pedido MB WAY. Nao guardamos o numero: guardamos uma impressao
            digital cifrada dele, que serve para recuperar os seus vouchers e nao permite
            reconstruir o numero.
          </li>
          <li>
            <strong className="text-text">O NIF</strong>, so se o indicar, e apenas para constar na
            fatura.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Nao pedimos email, nao criamos conta e nao usamos cookies de publicidade. O unico cookie e
          o da sua sessao, sem o qual a aplicacao nao consegue mostrar-lhe as suas compras.
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">Durante quanto tempo</h2>
        <p className="mt-2 text-sm text-muted">
          Os dados pessoais sao apagados depois do evento terminar. O prazo e definido pelo
          organizador e por omissao sao 30 dias. Ao fim dele, o nome, a impressao digital do
          telemovel e a equipa sao removidos. As faturas e os totais de vendas ficam pelo prazo que
          a lei fiscal exige, mas ja sem ligacao a si.
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">Os seus direitos</h2>
        <p className="mt-2 text-sm text-muted">
          Pode sair do ranking a qualquer momento, no separador Ranking. Pode pedir uma copia ou a
          eliminacao dos seus dados ao organizador do evento, que e o responsavel pelo tratamento e
          cujos contactos estao afixados no local.
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">Onde ficam</h2>
        <p className="mt-2 text-sm text-muted">
          Os dados sao alojados em servidores na Uniao Europeia.
        </p>
      </Card>

      <Link to="/" className="mt-8 inline-block text-accent underline">
        Voltar
      </Link>
    </main>
  );
}
