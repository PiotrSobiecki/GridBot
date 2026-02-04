/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'grid': {
          'bg': '#0a0e17',
          'card': '#111827',
          'border': '#1f2937',
          'accent': '#10b981',
          'accent-hover': '#059669',
          'danger': '#ef4444',
          'warning': '#f59e0b',
          'buy': '#22c55e',
          'sell': '#ef4444',
          'text': '#f9fafb',
          'text-muted': '#9ca3af',
        }
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
        'display': ['Outfit', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #10b981, 0 0 10px #10b981' },
          '100%': { boxShadow: '0 0 20px #10b981, 0 0 30px #10b981' },
        }
      }
    },
  },
  plugins: [],
}
