import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: ["node_modules/**", ".next/**", "data/**", "dist/**", "coverage/**"],
  },
  ...nextConfig,
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
