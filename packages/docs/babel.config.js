module.exports = {
  presets: ["next/babel"],
  plugins: [
    [require.resolve("iterate-ui-babel-plugin"), { root: process.cwd() }],
  ],
};
