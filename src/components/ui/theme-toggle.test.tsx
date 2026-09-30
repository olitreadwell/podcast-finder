import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { ThemeToggle } from '@/components/ui/theme-toggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('renders Light, Dark and System options', () => {
    renderToggle();
    for (const label of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active theme with aria-pressed', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to dark and persists the choice', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('has no axe violations', async () => {
    const { container } = renderToggle();
    expect(await axe(container)).toHaveNoViolations();
  });
});
