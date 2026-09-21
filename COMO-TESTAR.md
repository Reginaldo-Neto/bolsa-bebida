# Como rodar e testar

Guia para pôr a plataforma a correr na sua máquina e verificar que faz o que deve.
Não precisa de ler mais nada para seguir isto.

---

## 1. Instalar

Já tem Node, pnpm e Python. Falta uma coisa:

**Docker Desktop** — traz o PostgreSQL e o Redis. Num PowerShell **como administrador**:

```bash
winget install -e --id Docker.DockerDesktop
```

Depois:

1. **Reinicie o computador** (o instalador ativa o WSL2).
2. **Abra o Docker Desktop** e espere que o ícone da baleia fique estável.
3. **Feche e reabra o Git Bash**, senão o `docker` fica fora do PATH desta sessão.

Confirme:

```bash
docker --version
```

---

## 2. Primeiro arranque

Seis passos, uma vez só.

**2.1 — Configuração e dependências**

```bash
cp .env.example .env
corepack pnpm install
```

**2.2 — Base de dados e Redis**

```bash
docker compose -f infra/docker-compose.yml up -d
```

Verifique com `docker ps`. Deve ver **`bolsa-postgres`** e **`bolsa-redis`**, ambos com estado
`healthy` ao fim de alguns segundos.

**2.3 — Criar as tabelas**

```bash
corepack pnpm --filter @bolsa/db db:deploy
```

Deve dizer `All migrations have been successfully applied.`

**2.4 — Compilar**

```bash
corepack pnpm build
```

**2.5 — Criar a festa de teste**

```bash
corepack pnpm --filter @bolsa/api setup
```

Imprime um bloco com os endereços, as contas e o **segredo de 2FA do administrador**.
**Guarde essa saída** — o segredo não volta a aparecer.

Antes de continuar, adicione o segredo a uma aplicação de autenticação
(Google Authenticator, Aegis, 1Password). Sem isso não entra em `/admin`.

**2.6 — Levantar as três aplicações**, cada uma no seu terminal:

```bash
corepack pnpm --filter @bolsa/api start
```

```bash
corepack pnpm --filter @bolsa/worker start
```

```bash
corepack pnpm --filter @bolsa/web dev
```

### Sinais de que arrancou bem

| Onde | O que deve ver |
| --- | --- |
| Terminal da API | `API a escutar na porta 3000` |
| Terminal do worker | `worker pronto` |
| Terminal da web | `Local: http://localhost:5173/` |
| `curl http://localhost:3000/health` | `{"status":"ok","database":true}` |

Se o `/health` disser `"database":false`, o Postgres não está a responder — volte ao passo 2.2.

---

## 3. Antes de testar: acelere o mercado

Por omissão as cotações mudam de **2 em 2 minutos**, o que é certo para uma festa e mau para
testar. Entre em `/admin`, desça até **Motor de preços**, ponha o *Intervalo entre atualizações*
em **30 segundos** e guarde.

Se quiser ver movimento mais forte, suba também a *Resposta à procura* para `0.20`.

---

## 4. Percurso do participante

Abra o endereço `/e/<idDoEvento>` que o passo 2.5 imprimiu. Idealmente no telemóvel, na mesma
rede, trocando `localhost` pelo IP do PC. No computador, use o modo telemóvel das ferramentas de
programador (F12).

| # | O que fazer | O que deve acontecer |
| --- | --- | --- |
| 1 | Escrever um nome, marcar 18+, entrar | Entra no mercado. Não há email nem password |
| 2 | Olhar para um cartão de bebida | Preço grande, seta de variação, **intervalo mínimo–máximo** e mini-gráfico |
| 3 | Ver o canto superior direito | Indicador **"ao vivo"** a verde |
| 4 | Desligar o worker (Ctrl+C) e esperar ~1 min | O indicador continua ao vivo, mas os preços param |
| 5 | Voltar a ligar o worker | Passados ~30 s os preços mexem-se |
| 6 | Adicionar duas bebidas, ir ao carrinho | Total correto, limite de 4 por bebida referido |
| 7 | Carregar em **Pagar** | Contagem decrescente de **60 s** em números grandes |
| 8 | Esperar os 60 s sem confirmar | Diz que a cotação expirou e oferece ver os preços atuais |
| 9 | Pedir nova cotação, meter `912345678`, pagar | Ecrã "Confirme na aplicação MB WAY" |
| 10 | Carregar em **Confirmar pagamento** (botão de desenvolvimento) | Aparece o voucher com QR e código de 6 letras |
| 11 | Ir a **Vouchers** | O voucher está lá, marcado "Por levantar" |

O botão de confirmação só existe porque `NODE_ENV` é `development`. Em produção desaparece do
build e a API recusa a rota.

---

## 5. Percurso do bar

Abra `/staff` **noutro browser ou numa janela anónima** — se usar a mesma janela, partilha a
sessão do participante.

Entre com:

- **Evento:** o id que o passo 2.5 imprimiu
- **Email:** `bar@festa.pt`
- **Password:** `bar-da-festa-2026`

| # | O que fazer | O que deve acontecer |
| --- | --- | --- |
| 1 | Apontar a câmara ao QR do voucher | Ecrã cheio com o nome e as bebidas por entregar |
| 2 | Reparar no botão de entregar antes de marcar a idade | Está **desativado**. L5: álcool não sai sem verificação, e a API recusa mesmo que alguém tente pela rota |
| 3 | Marcar "Verificar identificação (18+)" e entregar uma | Fica "levantamento parcial", falta uma |
| 4 | Ver o telemóvel do participante | Atualiza sozinho, sem recarregar |
| 5 | Ler o mesmo QR outra vez e entregar o resto | Fica tudo levantado |
| 6 | Ler o QR pela terceira vez | Diz que já foi tudo levantado, com hora e ponto |
| 7 | Escrever o código de 6 letras em vez de ler o QR | Encontra o mesmo voucher |
| 8 | Escrever `912345678` no campo do telemóvel | Encontra os vouchers por levantar desse número |

O ponto 8 é para quem fechou a aplicação e não tem nada para mostrar.

---

## 6. Painel do organizador

Abra `/admin`. Entre com `admin@festa.pt`, `admin-da-festa-2026` e o código de 6 dígitos da
aplicação de autenticação.

| # | O que fazer | O que deve acontecer |
| --- | --- | --- |
| 1 | Olhar para o topo | Receita, unidades, pendentes e stock baixo, a atualizar sozinhos |
| 2 | Carregar em **Pausar** | O mercado congela. O participante continua a poder comprar |
| 3 | Carregar em **Abrir** | Os preços voltam a mexer-se |
| 4 | Carregar em **Preços fixos (emergência)** | Todas as bebidas voltam ao preço base e o motor para |
| 5 | Carregar em **Retomar cotações** | Volta ao normal |
| 6 | Numa bebida, **Ajustar → Fixar cotação** com valor fora do intervalo | Recusa, dizendo o intervalo permitido (L2) |
| 7 | **Ajustar stock** com `-10` e um motivo | O stock desce e aparece na auditoria em baixo |
| 8 | Descarregar `vendas.csv` | Ficheiro com uma linha por item vendido, valores em cêntimos |
| 9 | Desligar o worker e esperar o dobro do intervalo (1 min, se pôs 30 s) | Aparece um **alerta vermelho** a dizer que as cotações pararam |

---

## 7. Ecrã da festa e tabela de preços

| Endereço | O que verificar |
| --- | --- |
| `/screen?event=<id>` | Tabela grande com cotação, variação, mínimo e máximo, QR de entrada e mensagens rotativas |
| `/screen?event=<id>` com a API desligada | A tabela esbate-se e aparece **"a atualizar…"**. Nunca mostra preço velho como atual |
| `/prices?event=<id>` | Tabela a preto e branco, pronta a imprimir (L2) |
| `/privacidade` | Política de privacidade (L7) |

---

## 8. Testar o ranking

O ranking precisa de **pelo menos duas unidades compradas** por participante para alguém aparecer.

1. Entre com dois ou três nomes diferentes (janelas anónimas), marcando a caixa do ranking.
2. Compre duas bebidas com cada um, em momentos diferentes para os preços variarem.
3. Abra o separador **Ranking**.

O que deve ver: quem comprou mais abaixo do preço base fica à frente. **Comprar mais quantidade
não sobe a pontuação** — só contam as primeiras dez unidades. Não aparece em lado nenhum quanto
cada um bebeu ou gastou.

---

## 9. Testes automáticos

**Testes unitários e de propriedades** (não precisam de nada a correr):

```bash
corepack pnpm test
```

Passam mais de 200 testes, incluindo os invariantes do motor de preços e a verificação de que
nenhum texto da interface usa vocabulário proibido pela L3.

**Testes de integração** (precisam de uma base de dados só deles):

```bash
docker exec bolsa-postgres createdb -U bolsa bolsa_test
```

```bash
DATABASE_URL="postgresql://bolsa:bolsa@localhost:5432/bolsa_test?schema=public" corepack pnpm --filter @bolsa/db db:deploy
```

```bash
DATABASE_URL_TEST="postgresql://bolsa:bolsa@localhost:5432/bolsa_test?schema=public" corepack pnpm test
```

Nunca aponte isto para a base de dados de desenvolvimento: os testes limpam as tabelas entre
casos.

Entre eles estão os dois critérios de aceitação mais importantes: 200 compras simultâneas para 50
bebidas aceitam exatamente 50, e dez leituras do mesmo voucher entregam as bebidas uma só vez.

**Verificação completa** (lint, tipos e testes):

```bash
corepack pnpm check
```

---

## 10. Parar e recomeçar

Parar as aplicações: `Ctrl+C` em cada terminal.

Parar a base de dados, **mantendo** os dados:

```bash
docker compose -f infra/docker-compose.yml down
```

Apagar tudo e começar do zero:

```bash
docker compose -f infra/docker-compose.yml down -v
```

Depois repita os passos 2.2, 2.3 e 2.5.

---

## 11. Quando alguma coisa corre mal

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `docker: command not found` | Docker Desktop não instalado, ou terminal aberto antes da instalação | Reabra o Git Bash |
| `/health` diz `"database":false` | Postgres ainda a arrancar ou em baixo | `docker ps` e espere o `healthy` |
| API não arranca, fala de variáveis | Falta o `.env` | `cp .env.example .env` |
| Preços não mexem | Worker desligado, ou mercado em pausa/preços fixos | Veja o alerta no `/admin` |
| Preços mexem muito devagar | Intervalo de 120 s por omissão | Baixe para 30 s no `/admin` |
| Voucher não aparece depois de pagar | Pagamento por confirmar | Use o botão de desenvolvimento no ecrã de pagamento |
| Câmara não abre em `/staff` | O browser só dá câmara em HTTPS ou em `localhost` | Use `localhost`, ou o campo do código de 6 letras |
| `/admin` recusa o código | Relógio do telemóvel dessincronizado | Acerte a hora automática no telemóvel |
| Sessão de staff e de participante a baralharem-se | Mesma janela do browser | Use uma janela anónima para cada perfil |

Para ver o que a API está a fazer, os logs saem no terminal dela. A documentação interativa das
rotas está em **http://localhost:3000/api/docs**.

---

## 12. O que ainda não pode testar

- **Pagamento MB WAY a sério** — o gateway ainda não foi escolhido (secção 14.2 da especificação).
  O que existe é o simulador e um adapter escrito contra a forma comum destas APIs.
- **Fatura verdadeira** — idem para o software certificado pela AT. O documento fiscal é posto em
  fila e emitido por um simulador que regista o número.
- **Recuperação por SMS** — não há fornecedor escolhido. Em vez disso, o bar procura os vouchers
  pelo telemóvel do pagamento, com a pessoa à frente.

A API **recusa arrancar** com os simuladores quando `NODE_ENV=production`, por isso não há risco
de a festa a sério correr sem documentos fiscais por distração.
