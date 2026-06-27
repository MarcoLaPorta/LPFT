const path = require("path");

/** Path assoluti: così Tailwind trova i file anche se `next dev` parte con cwd ≠ apps/web. */
const root = __dirname;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(root, "app/**/*.{js,ts,jsx,tsx}"),
    path.join(root, "components/**/*.{js,ts,jsx,tsx}"),
    path.join(root, "lib/**/*.{js,ts,jsx,tsx}"),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
