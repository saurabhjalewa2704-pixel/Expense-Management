import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "tests/harness/**", "next-env.d.ts", "public/sw.js"] },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
