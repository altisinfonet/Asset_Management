/**
 * Placeholder design tokens. The real values will be generated from docs/design/tokens.json;
 * keep the shape (colour, spacing, radius, font) stable so web and mobile can adopt it.
 */
export const tokens = {
  color: {
    background: '#ffffff',
    foreground: '#0f172a',
    primary: '#2563eb',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, lg: 12 },
  font: { family: 'system-ui, sans-serif', size: { sm: 14, md: 16, lg: 20 } },
} as const;

export type Tokens = typeof tokens;
