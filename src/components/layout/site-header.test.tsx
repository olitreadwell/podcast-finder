import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { SiteHeader } from '@/components/layout/site-header';
import { ThemeProvider } from '@/components/providers/theme-provider';

function renderHeader() {
  return render(
    <ThemeProvider>
      <SiteHeader />
    </ThemeProvider>
  );
}

describe('SiteHeader', () => {
  it('renders a skip link and the theme toggle', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content'
    );
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderHeader();
    expect(await axe(container)).toHaveNoViolations();
  });
});
