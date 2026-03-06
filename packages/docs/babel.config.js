const plugins = [];

// The iterate babel plugin injects component names/source locations for the
// overlay's element inspector.  It's only useful during dev — skip it in
// production or when the built artifact isn't available yet (e.g. fresh CI).
try {
  const pluginPath = require.resolve("iterate-ui-babel-plugin");
  plugins.push([pluginPath, { root: process.cwd() }]);
} catch {
  // iterate-ui-babel-plugin not built yet — skip
}

module.exports = {
  presets: ["next/babel"],
  plugins,
};
