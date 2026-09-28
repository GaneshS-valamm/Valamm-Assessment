/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#d9e5ff', 200: '#bcd0ff', 300: '#8eb0ff',
          400: '#5a85fb', 500: '#3560f0', 600: '#2043d8', 700: '#1c36ad',
          800: '#1c3189', 900: '#1d2f6d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
