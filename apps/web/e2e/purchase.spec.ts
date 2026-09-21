import { expect, test } from '@playwright/test';

/**
 * F3 acceptance: join, buy and hold a voucher in under twenty seconds, on a
 * phone.
 *
 * Twenty seconds is not a performance target, it is the product: a queue at a
 * bar does not wait longer than that.
 */
const EVENT_ID = process.env.E2E_EVENT_ID;

test.describe('comprar uma bebida', () => {
  test.skip(!EVENT_ID, 'E2E_EVENT_ID nao definido: e preciso um evento aberto');

  test('entra, compra e recebe o voucher em menos de 20 segundos', async ({ page }) => {
    const started = Date.now();

    await page.goto(`/e/${EVENT_ID}`);

    // Entry: a nickname and the 18+ declaration, nothing else (spec 3).
    await page.getByLabel('Como quer ser tratado?').fill(`E2E ${Date.now() % 100000}`);
    await page.getByRole('checkbox', { name: /18 anos/ }).check();
    await page.getByRole('button', { name: 'Entrar no mercado' }).click();

    // The market, with the published range next to every price (L2).
    const firstProduct = page.getByRole('article').first();
    await expect(firstProduct).toBeVisible();
    await expect(firstProduct.getByText(/Intervalo/)).toBeVisible();

    await firstProduct.getByRole('button', { name: /^Adicionar/ }).click();
    await page.getByRole('button', { name: /Ver carrinho/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();

    // L1: the lock is visible and counting down.
    await expect(page.getByText('Precos bloqueados durante')).toBeVisible();
    await expect(page.getByRole('timer')).toContainText('s');

    await page.getByLabel('Telemovel MB WAY').fill('912345678');
    await page.getByRole('button', { name: /^Pagar / }).click();

    // Stands in for confirming in the MB WAY app.
    await expect(page.getByText('Confirme na aplicacao MB WAY')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar pagamento' }).click();

    // The voucher, with its QR and its readable fallback code.
    await expect(page.getByLabel('Codigo QR do voucher')).toBeVisible();
    await expect(page.getByText(/^[A-HJ-NP-Z2-9]{6}$/)).toBeVisible();

    const elapsed = Date.now() - started;
    expect(elapsed, `demorou ${Math.round(elapsed / 1000)}s`).toBeLessThan(20_000);
  });

  test('mostra o intervalo minimo-maximo de cada bebida (L2)', async ({ page }) => {
    await page.goto(`/e/${EVENT_ID}`);
    await page.getByLabel('Como quer ser tratado?').fill(`L2 ${Date.now() % 100000}`);
    await page.getByRole('checkbox', { name: /18 anos/ }).check();
    await page.getByRole('button', { name: 'Entrar no mercado' }).click();

    for (const product of await page.getByRole('article').all()) {
      await expect(product.getByText(/Intervalo .+ – .+/)).toBeVisible();
    }
  });

  test('nunca usa vocabulario de reducao de preco (L3)', async ({ page }) => {
    await page.goto(`/e/${EVENT_ID}`);
    await page.getByLabel('Como quer ser tratado?').fill(`L3 ${Date.now() % 100000}`);
    await page.getByRole('checkbox', { name: /18 anos/ }).check();
    await page.getByRole('button', { name: 'Entrar no mercado' }).click();

    const text = (await page.locator('body').innerText())
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();

    for (const forbidden of ['promocao', 'desconto', 'saldo']) {
      expect(text, `a pagina diz "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test('recusa entrar sem a declaracao de 18 anos (L5)', async ({ page }) => {
    await page.goto(`/e/${EVENT_ID}`);
    await page.getByLabel('Como quer ser tratado?').fill(`L5 ${Date.now() % 100000}`);

    await expect(page.getByRole('button', { name: 'Entrar no mercado' })).toBeDisabled();
  });
});

test.describe('ecra publico', () => {
  test.skip(!EVENT_ID, 'E2E_EVENT_ID nao definido');

  test('mostra as cotacoes com o intervalo afixado', async ({ page }) => {
    await page.goto(`/screen?event=${EVENT_ID}`);

    await expect(page.getByRole('columnheader', { name: 'Cotacao' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Minimo' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Maximo' })).toBeVisible();
    await expect(page.getByLabel('Codigo de entrada')).toBeVisible();
  });
});
