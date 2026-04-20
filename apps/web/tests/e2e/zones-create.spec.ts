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

test.describe('Zones creation', () => {
  test('Создать зону через UI → появляется в списке', async ({ page }) => {
    // 1. Мок /api/zones — GET возвращает пустой список, POST сохраняет и возвращает объект
    let zones: unknown[] = [];
    await page.route('**/api/zones', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(zones),
        });
      } else if (method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as {
          name: string;
          color: string;
          icon: string;
          centerLat: number;
          centerLon: number;
          radius: number;
          childIds?: string[];
        };
        const saved = {
          id: 'zone-1',
          familyId: 'fam-1',
          name: body.name,
          color: body.color,
          icon: body.icon,
          centerLat: body.centerLat,
          centerLon: body.centerLon,
          radius: body.radius,
          childIds: body.childIds ?? [],
          createdBy: 'u-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        zones = [saved];
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        });
      } else {
        await route.continue();
      }
    });

    // 2. Мок /api/zones/events — пустая страница
    await page.route('**/api/zones/events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
    });

    // 3. Мок /api/children — один тестовый ребёнок для чекбоксов
    await page.route('**/api/children', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            children: [{ id: 'c-1', name: 'Тестовый ребёнок', dateOfBirth: null, device: null }],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 4. Мок /api/auth/refresh — возвращаем валидный токен чтобы bootstrap не редиректил на /login
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-access-token',
          user: { id: 'u-1', email: E2E_EMAIL, name: 'Test Parent', locale: 'ru' },
          family: { id: 'fam-1', name: 'Test Family' },
        }),
      });
    });

    await login(page);
    await page.goto('/cabinet/zones', { waitUntil: 'networkidle' });

    // Empty state должен быть виден
    await expect(page.getByText(/У вас нет геозон/)).toBeVisible({ timeout: 10_000 });

    // Открыть диалог через кнопку «+ Новая» в шапке списка
    await page.getByRole('button', { name: /Новая/i }).first().click();

    // Диалог открылся — ждём заголовок
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Заполнить название зоны
    await page.getByLabel(/Название/i).fill('Школа');

    // Выбрать цвет — первая radio-кнопка в группе «Цвет зоны»
    await page
      .locator('[role="radiogroup"][aria-label="Цвет зоны"] [role="radio"]')
      .first()
      .click();

    // Выбрать иконку «Школа» (aria-label="Школа")
    await page.getByRole('radio', { name: 'Школа' }).click();

    // Нажать «Сохранить»
    await page.getByRole('button', { name: /^Сохранить$/ }).click();

    // Диалог закрылся
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Зона «Школа» появилась в списке
    await expect(page.getByText('Школа')).toBeVisible({ timeout: 5_000 });

    // Счётчик обновился до 1/20
    await expect(page.getByText(/Зоны \(1\/20\)/)).toBeVisible();
  });
});
