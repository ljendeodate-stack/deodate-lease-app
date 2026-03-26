/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        app: {
          bg: '#050608',
          shell: '#0a0c10',
          surface: '#10141a',
          panel: '#161c24',
          'panel-strong': '#1a212b',
          'panel-hover': '#202835',
          border: '#283241',
          'border-strong': '#39465a',
          chrome: '#0f1319',
        },
        txt: {
          primary: '#f5f7fb',
          muted: '#b8c0cc',
          dim: '#7f8b9d',
          faint: '#536072',
        },
        accent: {
          DEFAULT: '#d9ff2f',
          dim: '#b4d72a',
          fg: '#0b0d03',
          soft: '#edf8a0',
        },
        status: {
          'warn-bg': '#191408',
          'warn-border': '#584416',
          'warn-text': '#f0c772',
          'warn-title': '#fff1bf',
          'err-bg': '#1b0d11',
          'err-border': '#5d2530',
          'err-text': '#ff9dac',
          'err-title': '#ffd7df',
          'ok-bg': '#0d1710',
          'ok-border': '#26442f',
          'ok-text': '#8bd8a4',
          'ok-title': '#d7ffe3',
        },
      },
      boxShadow: {
        glass: '0 28px 80px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        panel: '0 16px 40px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        chrome: '0 10px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        accent: '0 10px 24px rgba(217, 255, 47, 0.12)',
      },
      backgroundImage: {
        'hero-radial': 'radial-gradient(circle at top, rgba(217, 255, 47, 0.10), transparent 32%), radial-gradient(circle at 20% 20%, rgba(103, 122, 155, 0.14), transparent 35%), linear-gradient(180deg, #080b10 0%, #050608 100%)',
      },
    },
  },
  plugins: [],
}
