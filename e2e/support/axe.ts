import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/** Violations d'accessibilité critiques ou sérieuses, lisibles dans le message d'échec. */
export async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.impact} · ${v.id} · ${v.help} · ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}
