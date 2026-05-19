/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // Secondary accent — pink/fuchsia for a more colourful UI.
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
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
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
        // Richer brand gradient: indigo -> violet -> fuchsia.
        'gradient-brand':
          'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
        // Light-mode app background wash. The dark-mode counterpart is set
        // via a raw `html.dark body` rule in index.css because Tailwind's
        // `@apply` parser treats a trailing "-dark" segment as a variant.
        'gradient-app':
          'radial-gradient(1200px 600px at 100% -10%, rgb(99 102 241 / 0.10), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgb(217 70 239 / 0.08), transparent 60%)',
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
