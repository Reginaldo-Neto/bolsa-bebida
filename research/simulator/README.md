# Simulador — calibração do motor de preços

Secção 13.2 da especificação. Serve para escolher α, β, γ e δ **antes** da festa e para a
análise científica posterior.

## Instalação

```bash
cd research/simulator
python -m pip install -e ".[dev]"
```

Os extras `[sim]` (NumPy, pandas) e `[plots]` (matplotlib) só são precisos para análise
exploratória. O motor e os testes de paridade usam apenas a biblioteca padrão, para que o CI
seja rápido e não parta com uma atualização do stack científico.

## Comandos

```bash
bolsa-sim run --ticks 120 --agents 200      # simula uma festa e imprime métricas
bolsa-sim sweep --seeds 3 --out out/sweep.csv  # varre a grelha de parâmetros
bolsa-sim verify                             # confirma paridade com o motor TypeScript
pytest -q                                    # testes
```

## Porque existe uma segunda implementação do motor

`src/bolsa_sim/engine.py` é um port de `packages/pricing-engine/src/engine.ts`. Duas
implementações do mesmo algoritmo é uma duplicação deliberada: permite explorar milhares de
combinações de parâmetros sem um processo Node no ciclo, e qualquer divergência entre
investigação e produção falha um teste em vez de aparecer durante a festa.

O contrato entre as duas são os vetores de teste partilhados em
`packages/pricing-engine/test-vectors/*.json` (secção 5.6). `tests/test_parity.py` corre todos
os vetores e compara os preços **exatamente** — são inteiros em cêntimos, não há tolerância.

O maior risco de divergência é o arredondamento: `Math.round` do JavaScript arredonda os meios
para cima, enquanto o `round` do Python usa arredondamento bancário. Por isso o port usa
`js_round` e nunca o `round` nativo. `tests/test_money.py` fixa essa diferença.

## O modelo de agentes

Cada participante tem preferências por bebida, sensibilidade ao preço, taxa de chegada ao bar
e orçamento. Em cada tick, quem chega escolhe uma bebida por *multinomial logit* sobre a
utilidade `ln(gosto) − sensibilidade × ln(preço / preço base)` — o modelo de escolha discreta
habitual na literatura de preços dinâmicos (den Boer, 2015).

A simulação é determinística para uma dada semente: duas execuções com a mesma configuração
dão resultados idênticos, para que uma varredura de parâmetros compare parâmetros e não sorte.

**Desvio à especificação:** a 13.2 sugere Mesa. O modelo aqui é um passo por tick sem
interação entre agentes, pelo que o escalonador do Mesa não acrescentaria nada e traria uma
dependência com API instável. Está implementado com a biblioteca padrão e uma semente
explícita. Se a tese exigir Mesa, o `simulate()` encaixa num `mesa.Model` sem alterações ao
motor.

## Métricas de saída

| Métrica | Significado |
| --- | --- |
| `revenue_cents` | Receita total |
| `units_sold` | Unidades vendidas |
| `price_volatility` | Variação relativa média do preço por tick |
| `time_at_bound` | Fração de (produto, tick) exatamente no mínimo ou no máximo |
| `stockouts` | Produtos que esgotaram |
| `revenue_deviation` | Receita face à mesma venda a preços base. Zero = neutro |
| `mean_saving`, `p10_saving`, `p90_saving` | Distribuição da poupança dos participantes |

Um bom conjunto de parâmetros tem `revenue_deviation` perto de zero, `time_at_bound` baixo
(os preços têm espaço para se mover) e `price_volatility` suficiente para o mercado ser
interessante sem ser errático.
