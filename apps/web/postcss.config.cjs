const path = require("path");

/** PostCSS + path esplicito a Tailwind (monorepo / cwd). */
module.exports = {
  plugins: {
    tailwindcss: {
      config: path.join(__dirname, "tailwind.config.cjs"),
    },
    autoprefixer: {},
  },
};
