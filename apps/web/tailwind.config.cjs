const path = require("path");
const root = __dirname;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(root, "app/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(root, "lib/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(root, "services/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(root, "components/**/*.{js,ts,jsx,tsx,mdx}"),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
