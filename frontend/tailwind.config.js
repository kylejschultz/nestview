/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0b0d14",
          1: "#13161f",
          2: "#1c202e",
          3: "#252a3a",
        },
        border: "#2e3347",
        accent: "#6366f1",
        "accent-hover": "#818cf8",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
