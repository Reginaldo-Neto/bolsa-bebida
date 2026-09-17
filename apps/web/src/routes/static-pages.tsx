import { AppHeader } from '../components/chrome';
import { Card } from '../components/ui';

/** Spec 11.2: how the market works, in the participant's own words. */
export function HelpScreen(): React.JSX.Element {
  return (
    <>
      <AppHeader title="Como funciona" />
      <main className="mx-auto max-w-lg space-y-4 px-4 pb-6">
        <Card className="mt-3">
          <h2 className="font-semibold">Os precos mexem-se</h2>
          <p className="mt-2 text-sm text-muted">
            A cada poucos minutos as cotacoes sao recalculadas conforme o que se esta a vender. Uma
            bebida muito procurada sobe; as alternativas do mesmo grupo descem.
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold">Ha sempre um teto</h2>
          <p className="mt-2 text-sm text-muted">
            Cada bebida tem um preco minimo e um preco maximo afixados. A cotacao nunca sai desse
            intervalo, aconteca o que acontecer.
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold">O preco que ve e o preco que paga</h2>
          <p className="mt-2 text-sm text-muted">
            Quando carrega em pagar, a cotacao fica bloqueada durante 60 segundos com uma contagem
            visivel. O valor cobrado e exatamente esse.
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold">Levantar a bebida</h2>
          <p className="mt-2 text-sm text-muted">
            Depois do pagamento recebe um voucher com codigo QR. Mostre-o no bar quando quiser, ate
            ao fim do evento. Nao tem de levantar tudo de uma vez.
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold">Consumo responsavel</h2>
          <p className="mt-2 text-sm text-muted">
            Ha um limite de bebidas alcoolicas por periodo de tempo, e agua disponivel a noite toda.
            A venda a menores de 18 anos e proibida; o pessoal do bar pode pedir identificacao.
          </p>
        </Card>
      </main>
    </>
  );
}

/** Spec 4.6: the ranking lands in F6; this explains what it will measure. */
export function RankingScreen(): React.JSX.Element {
  return (
    <>
      <AppHeader title="Melhor Trader" />
      <main className="mx-auto max-w-lg px-4 pb-6">
        <Card className="mt-3">
          <h2 className="font-semibold">Ainda nao ha ranking nesta festa</h2>
          <p className="mt-2 text-sm text-muted">
            A pontuacao mede a qualidade das compras: quanto melhor a cotacao a que comprou face ao
            preco base, mais pontos. Contam no maximo as primeiras dez unidades, por isso beber mais
            nunca da mais pontos.
          </p>
        </Card>
      </main>
    </>
  );
}

export function NotFoundScreen(): React.JSX.Element {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-price-lg font-bold">404</p>
        <p className="mt-2 text-muted">Esta pagina nao existe.</p>
        <a href="/" className="mt-6 inline-block text-accent underline">
          Voltar ao mercado
        </a>
      </div>
    </main>
  );
}
