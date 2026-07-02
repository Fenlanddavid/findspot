/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem' }],
        '3xs': ['0.625rem', { lineHeight: '0.8125rem' }],
      },
    },
  },
  plugins: [],
}
