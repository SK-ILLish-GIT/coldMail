/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Softer brand — violet (lavender) instead of indigo. Less navy.
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
        // Secondary accent — fuchsia.
        accent: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
        },
        // Pure neutral grays — no blue tint. Light mode reads as white-and-
        // gray, dark mode reads as black-and-gray.
        ink: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 4px 12px -2px rgb(15 23 42 / 0.05)',
        lift: '0 1px 3px 0 rgb(15 23 42 / 0.06), 0 8px 24px -6px rgb(15 23 42 / 0.10)',
        focus: '0 0 0 4px rgb(99 102 241 / 0.15)',
        'inner-soft': 'inset 0 1px 2px 0 rgb(15 23 42 / 0.04)',
      },
      backgroundImage: {
        // Brand gradient — violet -> fuchsia. Skips indigo to avoid the
        // "navy" look the previous gradient had.
        'gradient-brand':
          'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)',
        // Light-mode app background: a very subtle violet wash. Dark mode
        // intentionally has no wash (pure neutral gray) — set via
        // `html.dark body` in index.css.
        'gradient-app':
          'radial-gradient(1200px 600px at 100% -10%, rgb(139 92 246 / 0.08), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgb(217 70 239 / 0.06), transparent 60%)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 200ms ease-out',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
