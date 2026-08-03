/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0a0a0a",
        ink: "#fafafa",
        muted: "#a1a1aa",
        accent: "#34d399",
        card: "#141414",
        line: "rgba(255,255,255,0.1)",
      },
      boxShadow: {
        card: "0 2px 16px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
};
