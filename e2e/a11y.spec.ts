import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/', '/contact', '/feedback', '/help', '/login'];
const themes = [
  { name: 'light', colorScheme: 'light' as const, background: 'lab(98.26 0 0)' },
  { name: 'dark', colorScheme: 'dark' as const, background: 'lab(2.75381 0 0)' },
];

// Automated gate: WCAG 2.2 A/AA + best practice in both themes. AAA is a
// manual human review on top of this (see docs/a11y.md) because axe has no
// AAA rules.
test.describe('a11y audit (WCAG 2.2 A/AA + best practice)', () => {
  for (const route of routes) {
    for (const theme of themes) {
      test(`${route} has no axe violations (${theme.name})`, async ({ page }) => {
        // Emulate the OS color scheme before load so next-themes resolves
        // the theme class during render. Toggling the class after load hits
        // a Chromium stale-cascade quirk with :where() + @layer.
        await page.emulateMedia({ colorScheme: theme.colorScheme });
        await page.goto(route);
        // Ground truth that the theme actually applied before auditing it.
        // Tailwind v4 neutral-50/950 serialize as lab() in Chromium.
        const background = await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor
        );
        expect(background).toBe(theme.background);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
});
