/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary:  { DEFAULT: '#10B981', dark: '#059669', light: '#34D399', muted: '#D1FAE5', subtle: '#ECFDF5' },
        danger:   { DEFAULT: '#EF4444', dark: '#DC2626', light: '#F87171', muted: '#FEE2E2', subtle: '#FFF5F5' },
        warning:  { DEFAULT: '#F59E0B', dark: '#D97706', light: '#FCD34D', muted: '#FEF3C7', subtle: '#FFFBEB' },
        info:     { DEFAULT: '#3B82F6', dark: '#2563EB', light: '#60A5FA', muted: '#DBEAFE', subtle: '#EFF6FF' },
        accentpurple: { DEFAULT: '#8B5CF6', dark: '#7C3AED', light: '#A78BFA', muted: '#EDE9FE', subtle: '#F5F3FF' },
        surface:  '#FFFFFF',
        bg:       '#F8FAFC',
        sidebar:  '#0F172A',
        'sidebar-item': '#1E293B',
        'sidebar-active': '#1D4ED8',
        border:   '#E2E8F0',
        muted:    '#94A3B8',
        subtle:   '#F1F5F9',
        // ---- Paleta premium (dark/light) usada pelo novo tema do dashboard ----
        // Mantidas como tokens próprios (não substituem os de cima) para que
        // nenhuma página existente que usa bg-white/bg-bg/etc. seja afetada.
        canvas: { light: '#FAFAFA', dark: '#09090B' },
        panel:  { light: '#FFFFFF', dark: '#18181B' },
        ink:    { light: '#111827', dark: '#FAFAFA' },
        zinc400: '#A1A1AA',
      },
      fontFamily: {
        sans: ['"Inter"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card:  '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        modal: '0 20px 60px -10px rgb(0 0 0 / 0.2)',
        glow:  '0 0 20px rgb(16 185 129 / 0.15)',
        premium: '0 1px 2px 0 rgb(0 0 0 / 0.03), 0 4px 16px -4px rgb(0 0 0 / 0.06)',
        'premium-dark': '0 1px 2px 0 rgb(0 0 0 / 0.4), 0 4px 20px -4px rgb(0 0 0 / 0.5)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'slide-in':   'slideIn 0.25s ease-out',
        'scale-in':   'scaleIn 0.2s ease-out',
        'shimmer':    'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                           to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        scaleIn: { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      borderRadius: { xl: '12px', '2xl': '16px', '3xl': '20px', '4xl': '24px' },
      transitionTimingFunction: { smooth: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    },
  },
  plugins: [],
};