import { expect, test } from './fixtures';

test.use({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
});

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('fs_onboarding_v2_done', '1');
        localStorage.setItem('fs_onboarding_done', '1');
        localStorage.setItem('fs_fg_helpers_seen', '1');
    });
    await page.route(/^https:\/\//, route => route.abort());
});

for (const theme of ['dark', 'light'] as const) {
    test(`${theme} app paints the bottom safe area despite the opposite device theme`, async ({ page, context }) => {
        await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {
            insets: { top: 28, topMax: 28, bottom: 24, bottomMax: 24, left: 0, leftMax: 0, right: 0, rightMax: 0 },
        });
        await page.goto('./settings?tab=app');
        const dark = page.getByRole('button', { name: 'Dark', exact: true });
        await expect(dark).toBeVisible();
        if (theme === 'light') {
            await dark.click();
            await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
        }
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
        await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
        await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', theme);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(249, 250, 251)');
        expect(await page.locator('.app-shell').evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBe(28);
        const nav = page.getByRole('navigation', { name: 'Primary' });
        const barBefore = (await nav.boundingBox())!;
        expect(barBefore.y + barBefore.height).toBeCloseTo(915, 0);
        const links = await nav.locator('a').evaluateAll(elements => elements.map(element => {
            const r = element.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        }));
        for (const link of links) expect(link.bottom).toBeLessThanOrEqual(915 - 24);
        expect(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest('nav[aria-label="Primary"]'))).toBe(true);
        await page.screenshot({ path: `/tmp/findspot-safe-area-${theme}.png` });

        // Chrome's bottom UI retracts without resizing the navigation itself.
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {
            insets: { top: 28, topMax: 28, bottom: 0, bottomMax: 24, left: 0, leftMax: 0, right: 0, rightMax: 0 },
        });
        const barAfter = (await nav.boundingBox())!;
        expect(barAfter.height).toBeCloseTo(barBefore.height, 0);
        expect(barAfter.y + barAfter.height).toBeGreaterThanOrEqual(915);
        expect(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight - 1)?.closest('nav[aria-label="Primary"]'))).toBe(true);
        await nav.getByRole('link', { name: 'Permissions', exact: true }).click();
        await expect(page).toHaveURL(/\/permissions$/);
    });
}
