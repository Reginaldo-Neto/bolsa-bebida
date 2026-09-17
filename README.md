# Bolsa de Bebidas

Plataforma web mobile-first onde os preços das bebidas variam em tempo real conforme a procura,
dentro de um intervalo mínimo–máximo fixo por bebida.

A especificação completa está em
[Bolsa de Bebidas — Especificação Técnica para Implementação.md](./Bolsa%20de%20Bebidas%20—%20Especificação%20Técnica%20para%20Implementação.md).
O roadmap por fases está na secção 14 desse documento.

## O que precisa de instalar

| Ferramenta | Versão | Para quê |
| --- | --- | --- |
| Node.js | ≥ 20.11 (testado em 24) | tudo |
| pnpm | 9.15.4 | via `corepack enable`, ou `corepack pnpm <cmd>` sem instalar nada |
| **Docker Desktop** | recente | PostgreSQL 16 e Redis 7 |
| Python | 3.11+ | apenas para `research/simulator` |

**Docker Desktop é o único que falta instalar de raiz.** Descarregue de
[docker.com](https://www.docker.com/products/docker-desktop/), instale e deixe-o a correr. No
Windows pede o WSL2, que o próprio instalador ativa.

Sem Docker é possível instalar PostgreSQL 16 e Redis nativamente, mas no Windows o Redis não tem
build oficial — teria de usar o [Memurai](https://www.memurai.com/) (edição de programador
gratuita). O caminho com Docker é mais curto.

Se `corepack enable` falhar por falta de permissões no Windows, use `corepack pnpm ...`
em vez de `pnpm ...` — funciona sem instalação global.

## Arranque, passo a passo

**1. Configuração e dependências**

```bash
cp .env.example .env
corepack pnpm install
```

**2. Base de dados e Redis**

```bash
docker compose -f infra/docker-compose.yml up -d
```

Confirme que ambos estão de pé com `docker ps`. Deve ver `bolsa-postgres` e `bolsa-redis`.

**3. Criar as tabelas**

```bash
corepack pnpm --filter @bolsa/db db:deploy
```

**4. Compilar**

```bash
corepack pnpm build
```

**5. Criar uma festa de teste**

```bash
corepack pnpm --filter @bolsa/api setup
```

Isto cria o evento já aberto, sete bebidas em três grupos de substituição, uma conta de
administrador e uma conta de bar. **Guarde o que este comando imprime**: os endereços, as
passwords e o segredo de 2FA do administrador, que só aparece aqui.

Adicione esse segredo a uma aplicação de autenticação (Google Authenticator, Aegis, 1Password)
antes de tentar entrar em `/admin`.

**6. Levantar as três aplicações**, cada uma no seu terminal:

```bash
corepack pnpm --filter @bolsa/api start
```

```bash
corepack pnpm --filter @bolsa/worker start
```

```bash
corepack pnpm --filter @bolsa/web dev
```

O worker é o que faz os preços mexerem-se: de dois em dois minutos recalcula as cotações a partir
das vendas pagas. Sem ele o mercado funciona, mas os preços ficam parados.

## O que abrir

O comando do passo 5 imprime estes endereços já com o identificador do evento:

| Endereço | Quem usa |
| --- | --- |
| `/e/<idDoEvento>` | participante — é para aqui que o QR Code aponta |
| `/staff` | bar, com a conta `bar@festa.pt` |
| `/admin` | organizador, com `admin@festa.pt` e o código de 2FA |
| `/screen?event=<idDoEvento>` | ecrã grande da festa |
| `/prices?event=<idDoEvento>` | tabela mínimo–máximo para imprimir e afixar (L2) |

Para experimentar o percurso completo: entre pelo endereço do participante, escolha um nome,
adicione bebidas e pague. Como o gateway é simulado, a encomenda fica a aguardar confirmação e o
ecrã de pagamento mostra, em modo de desenvolvimento, dois botões que fazem o que o webhook do MB
WAY faria. Confirme, e o voucher aparece — pronto a ser lido em `/staff`.

Esses botões só existem em desenvolvimento: o `import.meta.env.DEV` retira-os do build de produção
e a API recusa a rota quando `NODE_ENV=production`.

## Testes sem Docker

Os testes de integração precisam de um PostgreSQL a sério: o que eles verificam são garantias
transacionais (updates condicionais, locks de linha, restrições CHECK) e uma base de dados
simulada não provaria nada sobre isso. Sem `DATABASE_URL_TEST` definido, fazem *skip*.

Se não puder instalar Docker, há um PostgreSQL compilado para WASM:

```bash
corepack pnpm test:db
```

Noutro terminal:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" corepack pnpm db:migrate:test
DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=1&pgbouncer=true" corepack pnpm test
```

O `connection_limit=1&pgbouncer=true` é obrigatório: o servidor de sockets do PGlite multiplexa
todas as ligações numa só instância, e os nomes de *prepared statements* colidem entre ligações.
É a mesma limitação do pgbouncer em modo transação.

## Comandos

| Comando | Função |
| --- | --- |
| `pnpm build` | Compila todos os pacotes e apps |
| `pnpm test` | Testes unitários e de propriedades |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript sem emitir |
| `pnpm check` | Lint + typecheck + testes |
| `pnpm format` | Prettier |

## Estrutura

```text
apps/
  web/              PWA: rotas /, /staff, /admin, /screen, /prices
  api/              NestJS: REST + WebSocket
  worker/           BullMQ: tick do motor, expirações, pagamentos, faturação
packages/
  shared/           Tipos, schemas Zod, dinheiro em cêntimos, máquinas de estado
  pricing-engine/   Motor de preços puro + vetores de teste
  db/               Prisma: schema, migrações e cliente
  core/             Domínio NestJS partilhado pela API e pelo worker
  ui/               Componentes React partilhados
research/
  simulator/        Python: simulação baseada em agentes para calibrar o motor
infra/
  docker-compose.yml
  Caddyfile
```

As dependências apontam sempre para dentro: `shared` não conhece ninguém, o motor só conhece
`shared`, o `core` conhece os três pacotes abaixo dele, e as apps são apenas arranque de
processo. O motor de preços não toca em base de dados nem na rede.

O domínio vive em `packages/core` e não dentro da API porque o worker precisa exatamente da
mesma lógica de liquidação de pagamentos e de stock. A alternativa seria o worker ter a sua
própria cópia, que mais cedo ou mais tarde divergiria.

## Regras que o código tem de respeitar

Estas vêm da secção 2 da especificação e são restrições rígidas:

- **L1** — o preço mostrado no checkout fica bloqueado durante a validade da cotação (60 s) e é
  exatamente o valor cobrado.
- **L2** — mínimo e máximo de cada produto sempre visíveis; rota `/prices` imprimível.
- **L3** — nunca usar "promoção", "desconto", "saldo" ou percentagens de desconto. Usar
  "cotação" e "variação". Há um teste automático que verifica isto.
- **L4** — nenhum ranking ou badge premeia quantidade consumida.
- **L5** — autodeclaração 18+; staff confirma identificação em encomendas com álcool.
- **L6** — cada pagamento gera documento fiscal via software certificado pela AT.
- **L7** — recolha mínima de dados, ranking opt-in, alojamento na UE.
- **L8** — limite configurável de unidades alcoólicas por janela de tempo.

Dinheiro é **sempre** um inteiro em cêntimos. Nunca floats.
