/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
        /* Semantic UI — driven by CSS variables in src/styles/theme.css */
        ui: {
          app: 'rgb(var(--cm-app) / <alpha-value>)',
          panel: {
            DEFAULT: 'rgb(var(--cm-panel) / <alpha-value>)',
            muted: 'rgb(var(--cm-panel-muted) / <alpha-value>)',
          },
          inset: 'rgb(var(--cm-inset) / <alpha-value>)',
          border: 'rgb(var(--cm-border) / <alpha-value>)',
          fg: {
            DEFAULT: 'rgb(var(--cm-fg) / <alpha-value>)',
            muted: 'rgb(var(--cm-fg-muted) / <alpha-value>)',
            subtle: 'rgb(var(--cm-fg-subtle) / <alpha-value>)',
          },
          preview: 'rgb(var(--cm-preview) / <alpha-value>)',
          overlay: 'rgb(var(--cm-overlay) / <alpha-value>)',
        },
        /* Legacy ink scale — aliases warm light / charcoal dark for gradual migration */
        ink: {
          50: 'rgb(var(--cm-inset) / 1)',
          100: 'rgb(var(--cm-inset) / 1)',
          200: 'rgb(var(--cm-border) / 1)',
          300: '#a8a29e',
          400: 'rgb(var(--cm-fg-subtle) / 1)',
          500: 'rgb(var(--cm-fg-muted) / 1)',
          600: 'rgb(var(--cm-fg-subtle) / 1)',
          700: '#57534e',
          800: 'rgb(var(--cm-inset) / 1)',
          900: 'rgb(var(--cm-fg) / 1)',
          950: 'rgb(var(--cm-app) / 1)',
        },
        elevated: {
          DEFAULT: 'rgb(var(--cm-panel) / 1)',
          muted: 'rgb(var(--cm-panel-muted) / 1)',
        },
        canvas: {
          DEFAULT: 'rgb(var(--cm-inset) / 1)',
          soft: 'rgb(var(--cm-app) / 1)',
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
        soft: '0 1px 2px 0 rgb(var(--cm-shadow) / 0.06), 0 4px 12px -2px rgb(var(--cm-shadow) / 0.07)',
        lift: '0 1px 3px 0 rgb(var(--cm-shadow) / 0.08), 0 8px 24px -6px rgb(var(--cm-shadow) / 0.12)',
        focus: '0 0 0 4px rgb(139 92 246 / 0.2)',
        'inner-soft': 'inset 0 1px 2px 0 rgb(var(--cm-shadow) / 0.05)',
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
