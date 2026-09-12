import { test, expect } from './fixtures';
import { seedBrief } from './helpers/uiBrief';
const phase = process.env.FINDSPOT_UI_PHASE || 'after';
for (const theme of ['light', 'dark']) {
  test(`brief phone layouts ${theme}`, async ({ page, context }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await context.setGeolocation({ latitude: 52.2053, longitude: 0.1218, accuracy: 8 });
    await seedBrief(page);
    for (const [name, path] of [['finds', './finds-box'], ['filters', './finds-box'], ['map', './finds-box?view=map'], ['permissions', './permissions'], ['record', './find?permissionId=permission-1&mode=full'], ['capture', './session/session-1'], ['fieldguide', './fieldguide?lat=52.2053&lng=0.1218']]) {
      await page.goto(path);
      if (name === 'capture') await page.getByRole('button', { name: 'Add Find to Session' }).click();
      await expect(name === 'capture' ? page.getByRole('dialog', { name: 'Record a find' }) : page.locator('main').first()).toBeVisible();
      if (name === 'record') {
        await expect(page.getByRole('button', { name: 'Save Find', exact: true })).toBeVisible();
        const skip = page.getByRole('button', { name: 'Skip', exact: true });
        if (await skip.isVisible()) await skip.click();
      }
      if (name === 'permissions') {
        await page.getByPlaceholder('Search by name, landowner, or notes...').fill('North Field');
        await expect(page.getByRole('button', { name: 'Resume visit', exact: true })).toBeVisible();
      }
      if (name === 'filters') {
        await page.getByRole('button', { name: 'Filters', exact: true }).click();
        await page.getByRole('combobox', { name: 'Permission', exact: true }).selectOption('permission-1');
        await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('Medieval');
      }
      if (name === 'map') {
        await expect(page.getByRole('button', { name: 'Show all results' })).toBeEnabled();
        await page.locator('section[aria-label="Finds map"]').scrollIntoViewIfNeeded();
      }
      if (name === 'fieldguide') await expect(page.getByText('Ready to Scan', { exact: true })).toBeVisible();
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.waitForTimeout(600);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await page.screenshot({ path: `docs/ui-refinement/screenshots/${phase}-${name}-${theme}.png` });
      if (['finds', 'filters', 'permissions', 'record'].includes(name)) {
        await page.screenshot({ path: `docs/ui-refinement/screenshots/${phase}-${name}-${theme}-full.png`, fullPage: true });
      }
    }
  });
}
