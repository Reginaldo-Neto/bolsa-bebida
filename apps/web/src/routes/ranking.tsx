import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';

/**
 * Spec 4.6: "Melhor Trader".
 *
 * Shows position, nickname and points, and nothing else. L4 forbids rewarding
 * how much someone drank, so quantities and amounts spent never appear here.
 */
export function RankingScreen(): React.JSX.Element {
  const queryClient = useQueryClient();

  const board = useQuery({
    queryKey: ['leaderboard'],
    queryFn: api.leaderboard,
    refetchInterval: 30_000,
  });

  const optIn = useMutation({
    mutationFn: (value: boolean) => api.setLeaderboardOptIn(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });

  if (board.isLoading) {
    return <Spinner label="A carregar o ranking" />;
  }

  const data = board.data;
  const me = data?.me;

  return (
    <>
      <AppHeader title="Melhor Trader" />
      <main className="mx-auto max-w-lg px-4 pb-6">
        <Card className="mt-3">
          <p className="text-sm text-muted">
            A pontuacao mede a qualidade das compras: quanto melhor a cotacao a que comprou face ao
            preco base, mais pontos. Contam no maximo as primeiras dez unidades, por isso beber mais
            nunca da mais pontos.
          </p>
        </Card>

        {me && !me.optedIn && (
          <div className="mt-4">
            <Alert>
              Nao esta no ranking. A sua pontuacao e visivel apenas para si.
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={optIn.isPending}
                onClick={() => optIn.mutate(true)}
              >
                Entrar no ranking
              </Button>
            </Alert>
          </div>
        )}

        {me && (
          <Card className="mt-4 border-accent">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted">A sua pontuacao</p>
                <p className="text-price font-bold tabular">{me.points} pontos</p>
              </div>
              {me.optedIn && me.position > 0 && (
                <p className="text-price font-bold tabular text-accent">#{me.position}</p>
              )}
            </div>
          </Card>
        )}

        {data && data.entries.length === 0 ? (
          <p className="py-12 text-center text-muted">
            Ainda ninguem tem compras suficientes para entrar no ranking.
          </p>
        ) : (
          <ol className="mt-6 space-y-2">
            {data?.entries.map((entry) => (
              <li
                key={entry.participantId}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  entry.participantId === me?.participantId
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-surface'
                }`}
              >
                <span className="w-8 text-center text-lg font-bold tabular text-muted">
                  {entry.position}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.nickname}</span>
                {entry.teamCode && (
                  <span className="rounded-full bg-raised px-2 py-1 text-xs text-muted">
                    {entry.teamCode}
                  </span>
                )}
                <span className="font-semibold tabular">{entry.points}</span>
              </li>
            ))}
          </ol>
        )}

        {data && data.teams.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Equipas</h2>
            <ol className="space-y-2">
              {data.teams.map((team) => (
                <li
                  key={team.teamCode}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3"
                >
                  <span className="w-8 text-center text-lg font-bold tabular text-muted">
                    {team.position}
                  </span>
                  <span className="flex-1">{team.teamCode}</span>
                  <span className="text-sm text-muted">
                    {team.members} {team.members === 1 ? 'pessoa' : 'pessoas'}
                  </span>
                  <span className="font-semibold tabular">{team.points}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {me?.optedIn && (
          <button
            type="button"
            className="mt-8 min-h-12 w-full text-sm text-muted underline"
            disabled={optIn.isPending}
            onClick={() => optIn.mutate(false)}
          >
            Sair do ranking
          </button>
        )}
      </main>
    </>
  );
}
