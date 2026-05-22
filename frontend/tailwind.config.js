export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ocean: { DEFAULT: '#006A73', light: '#2CC5CF', dark: '#004E56' },
        forest: { DEFAULT: '#198F53', dark: '#126B3D' },
        glow: { DEFAULT: '#FFB800', dark: '#CC9300' },
        midnight: '#1A1A1A',
        graphite: { DEFAULT: '#2E2E2E', light: '#3A3A3A', lighter: '#484848' },
      },
    }
  },
  plugins: []
}
