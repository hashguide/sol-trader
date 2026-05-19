/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        bg: {
          950: '#060608',
          900: '#0c0d10',
          800: '#131419',
          700: '#1a1b22',
          600: '#22242e',
        },
        accent: {
          green: '#00ff88',
          red: '#ff3b5c',
          blue: '#4d9eff',
          yellow: '#ffcc00',
          purple: '#a855f7',
          orange: '#ff6b35',
        },
        border: '#1e2028',
      },
      animation: {
        'pulse-green': 'pulseGreen 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'ticker': 'ticker 20s linear infinite',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        slideIn: {
          from: { transform: 'translateX(20px)', opacity: 0 },
          to: { transform: 'translateX(0)', opacity: 1 },
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        ticker: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
}
