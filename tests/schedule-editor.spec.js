import { expect, test } from '@playwright/test';

async function openManualEditor(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Schedule Editor' }).click();
  await page.getByRole('button', { name: 'Manual Entry' }).click();
}

function row(page, index) {
  return page.locator('tbody tr').nth(index);
}

async function expectScheduleCell(page, text) {
  await expect(page.locator('td').filter({ hasText: new RegExp(`^${text.replace(/\//g, '\\/')}$`) }).first()).toBeVisible();
}

async function expectCurrencyCell(page, text) {
  await expect(page.locator('td').filter({ hasText: new RegExp(`^\\$${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first()).toBeVisible();
}

async function fillDateSchedule(page) {
  await row(page, 0).getByPlaceholder('MM/DD/YYYY').first().fill('06/26/2024');
  await row(page, 0).getByPlaceholder('MM/DD/YYYY').nth(1).fill('06/25/2025');
  await page.getByTestId('row-1-rent').fill('1000');
  await page.getByTestId('row-1-rent').blur();

  await row(page, 1).getByPlaceholder('MM/DD/YYYY').first().fill('06/26/2025');
  await row(page, 1).getByPlaceholder('MM/DD/YYYY').nth(1).fill('01/25/2026');
  await page.getByTestId('row-2-rent').fill('1200');
  await page.getByTestId('row-2-rent').blur();

  await row(page, 2).getByPlaceholder('MM/DD/YYYY').first().fill('01/26/2026');
  await row(page, 2).getByPlaceholder('MM/DD/YYYY').nth(1).fill('06/25/2026');
  await page.getByTestId('row-3-rent').fill('1400');
  await page.getByTestId('row-3-rent').blur();
}

test('formats quick-entry Year 1 rent with commas and preserves the generated amount', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Schedule Editor' }).click();
  await page.getByRole('button', { name: 'Quick Entry' }).click();

  await page.getByPlaceholder('MM/DD/YYYY').first().fill('06/26/2024');
  await page.getByPlaceholder('MM/DD/YYYY').nth(1).fill('06/25/2026');
  await page.getByTestId('quick-year1-rent').fill('98463.60');
  await page.getByTestId('quick-year1-rent').blur();
  await expect(page.getByTestId('quick-year1-rent')).toHaveValue('98,463.60');
  await page.getByPlaceholder('e.g. 3').fill('3');

  await page.getByRole('button', { name: 'Generate Schedule Preview' }).click();
  await expect(page.getByText('Generated Schedule')).toBeVisible();
  await expectCurrencyCell(page, '98,463.60');
});

test('supports month-number entry, predictive end fill, and comma-formatted rent input', async ({ page }) => {
  await openManualEditor(page);

  await row(page, 0).getByPlaceholder('MM/DD/YYYY').first().fill('06/26/2024');
  await page.getByTestId('row-1-rent').fill('98463.60');
  await page.getByTestId('row-1-rent').blur();
  await expect(page.getByTestId('row-1-rent')).toHaveValue('98,463.60');

  await page.getByTestId('row-2-start-month').fill('13');
  await page.getByTestId('row-2-start-month').blur();
  await expect(row(page, 0).getByPlaceholder('MM/DD/YYYY').nth(1)).toHaveValue('06/25/2025');
  await expect(row(page, 1).getByPlaceholder('MM/DD/YYYY').first()).toHaveValue('06/26/2025');

  await page.getByTestId('row-3-start-month').fill('20');
  await page.getByTestId('row-3-start-month').blur();
  await expect(row(page, 1).getByPlaceholder('MM/DD/YYYY').nth(1)).toHaveValue('01/25/2026');
  await expect(row(page, 2).getByPlaceholder('MM/DD/YYYY').first()).toHaveValue('01/26/2026');

  await page.getByTestId('row-2-rent').fill('1200');
  await page.getByTestId('row-2-rent').blur();
  await page.getByTestId('row-3-end-month').fill('24');
  await page.getByTestId('row-3-end-month').blur();
  await page.getByTestId('row-3-rent').fill('1400');
  await page.getByTestId('row-3-rent').blur();

  await page.getByRole('button', { name: 'Continue with Schedule' }).click();
  await expect(page.getByText('Lease Assumptions')).toBeVisible();
  await expectScheduleCell(page, '06/26/2024');
  await expectScheduleCell(page, '06/25/2025');
  await expectScheduleCell(page, '01/25/2026');
  await expectScheduleCell(page, '06/25/2026');
});

test('clamps backward month entry so later rows cannot move before the prior period end', async ({ page }) => {
  await openManualEditor(page);

  await row(page, 0).getByPlaceholder('MM/DD/YYYY').first().fill('06/26/2024');
  await page.getByTestId('row-1-end-month').fill('12');
  await page.getByTestId('row-1-end-month').blur();
  await page.getByTestId('row-2-start-month').fill('5');
  await page.getByTestId('row-2-start-month').blur();

  await expect(page.getByTestId('row-2-start-month')).toHaveValue('13');
  await expect(row(page, 1).getByPlaceholder('MM/DD/YYYY').first()).toHaveValue('06/26/2025');
});

test('date entry reaches the same confirmed schedule preview as month entry', async ({ page }) => {
  await openManualEditor(page);
  await fillDateSchedule(page);

  await page.getByRole('button', { name: 'Continue with Schedule' }).click();
  await expect(page.getByText('Lease Assumptions')).toBeVisible();
  await expectScheduleCell(page, '06/26/2024');
  await expectScheduleCell(page, '06/25/2025');
  await expectScheduleCell(page, '01/25/2026');
  await expectScheduleCell(page, '06/25/2026');
});
