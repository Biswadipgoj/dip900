/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: { display: ['Georgia', 'serif'] },
      colors: {
        // Light theme palette
        brand: {
          50:  '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047',
          400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207',
        },
        ink:  { DEFAULT: '#1e293b', light: '#334155', muted: '#64748b' },
        surface: { DEFAULT: '#ffffff', 2: '#f8fafc', 3: '#f1f5f9', 4: '#e2e8f0' },
        success: { DEFAULT: '#16a34a', light: '#dcfce7', border: '#86efac' },
        warning: { DEFAULT: '#d97706', light: '#fef3c7', border: '#fcd34d' },
        danger:  { DEFAULT: '#dc2626', light: '#fee2e2', border: '#fca5a5' },
        info:    { DEFAULT: '#2563eb', light: '#dbeafe', border: '#93c5fd' },

        // Legacy dark-theme palette — kept so old class names still compile
        gold: {
          300: '#fcd97a', 400: '#f5c842', 500: '#e8b800', 600: '#c99b00',
        },
        jade: {
          400: '#34d399', 500: '#10b981',
        },
        crimson: {
          300: '#fca5a5', 400: '#f87171', 500: '#ef4444',
        },
        sapphire: {
          300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6',
        },
        obsidian: {
          600: '#1e2847', 700: '#161d35', 800: '#0f1425',
          900: '#0a0d1a', 950: '#060810',
        },
        slate: {
          200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
          500: '#64748b', 600: '#475569', 700: '#334155',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.05)',
        modal: '0 8px 40px rgba(0,0,0,0.15)',
      },
      animation: {
        'fade-in':  'fadeIn 0.2s ease-out both',
        'slide-up': 'slideUp 0.25s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scaleIn 0.2s ease-out both',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'shimmer':    'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        scaleIn:   { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        pulseGold: { '0%,100%': { boxShadow: '0 0 0 0 rgba(232,184,0,0.4)' }, '50%': { boxShadow: '0 0 0 8px rgba(232,184,0,0)' } },
        shimmer:   { '0%': { backgroundPosition: '-1000px 0' }, '100%': { backgroundPosition: '1000px 0' } },
      },
    },
  },
  plugins: [],
};
