import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e-parent@example.com';
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'Password123!';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/Email/i).fill(E2E_EMAIL);
  await page.getByLabel(/Пароль/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /Войти/ }).click();
  await page.waitForURL(/\/cabinet\//);
}

test.describe('Карта ребёнка', () => {
  test('happy path: маркер + селектор даты работают', async ({ page }) => {
    await page.route('**/api/children/**/location/latest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lat: 55.75,
          lon: 37.61,
          recordedAt: new Date(Date.now() - 20_000).toISOString(),
          serverReceivedAt: new Date().toISOString(),
          accuracy: 10,
          altitude: null,
          speed: null,
          bearing: null,
          batteryLevel: 75,
          isCharging: false,
          provider: 'fused',
          ageSec: 20,
        }),
      });
    });

    await page.route('**/api/children/**/location/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: Array.from({ length: 5 }, (_, i) => ({
            lat: 55.75 + i * 0.001,
            lon: 37.61 + i * 0.001,
            recordedAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
            accuracy: null,
            speed: null,
          })),
          nextCursor: null,
        }),
      });
    });

    await login(page);
    await page.goto('/cabinet/children');
    const mapLink = page.getByRole('link', { name: /На карту/ }).first();
    await expect(mapLink).toBeVisible({ timeout: 10_000 });
    await mapLink.click();
    await page.waitForURL(/\/cabinet\/children\/.+\/map$/);

    await expect(page.getByRole('status')).toContainText(/Обновлено/);
    await expect(page.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Вчера' }).click();
    await expect(page.getByRole('button', { name: 'Вчера' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('empty-state при 204 latest + пустая history', async ({ page }) => {
    await page.route('**/api/children/**/location/latest', (r) => r.fulfill({ status: 204 }));
    await page.route('**/api/children/**/location/history**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      }),
    );
    await login(page);
    await page.goto('/cabinet/children');
    const mapLink = page.getByRole('link', { name: /На карту/ }).first();
    await expect(mapLink).toBeVisible({ timeout: 10_000 });
    await mapLink.click();
    await expect(page.getByText(/ещё не приходили координаты/)).toBeVisible();
  });
});
