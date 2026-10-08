/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F7F8FC',
        card: '#FFFFFF',
        line: '#E2E8F0',
        ink: '#12152B',
        slate: '#4F5775',
        mute: '#6B7280',
        violet: '#7C3AED',
        blue: '#2563EB',
        cyan: '#0891B2',
        red: '#DC2626',
        redsoft: '#FEE2E2',
        amber: '#D97706',
        ambersoft: '#FEF3C7',
        green: '#16A34A',
        greensoft: '#DCFCE7',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'card': '14px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(15,23,42,.06)',
      },
      gridTemplateColumns: {
        '13': 'repeat(13, minmax(0, 1fr))',
      },
      gridTemplateRows: {
        '8': 'repeat(8, minmax(0, 1fr))',
      }
    },
  },
  plugins: [],
}
