const fs = require("fs");
const path = require("path");
const _ = require("lodash");

const fixtures = path.join(__dirname, "fixtures");

const tests = fs.readdirSync(fixtures).map(name => {
  const dirname = path.relative(__dirname, path.join(fixtures, name));

  return {
    name: _.camelCase(name),
    dirname,
    input: `./${path.join(dirname, "input.js")}`,
    output: path.join(dirname, "output.js")
  };
});

const html = path.join(__dirname, "..", "doc-babel.html");

fs.writeFileSync(
  html,
  fs.readFileSync(html, "utf8").replace(
    /\n\s*<!-- INJECTED-START[\s\S]*INJECTED-END -->\n/,
    `
    <!-- INJECTED-START -->
    <!--
      Content generated by examples/babel/webpack.config.js.
      Run "yarn build" to update.
    -->${tests
      .map(
        ({ name, output }) =>
          `\n    <script src="${path.join("babel", output)}"></script>` +
          `\n    <button onclick="${name}()">Run ${name}</button>`
      )
      .join("")}
    <!-- INJECTED-END -->
`
  )
);

module.exports = [
  {
    context: __dirname,
    entry: "babel-polyfill",
    output: {
      filename: "polyfill-bundle.js"
    }
  }
].concat(
  tests.map(({ name, dirname, input, output }) => {
    const babelEnv = name !== "webpackModulesEs6";
    const babelModules = name !== "webpackModules";

    return {
      context: __dirname,
      entry: input,
      output: {
        path: __dirname,
        filename: output,

        libraryTarget: "var",
        library: name
      },
      devtool: "sourcemap",
      module: {
        loaders: [
          {
            test: /\.js$/,
            exclude: /node_modules/,
            loader: "babel-loader",
            options: {
              babelrc: false,
              presets: babelEnv
                ? [["env", { modules: babelModules ? "commonjs" : false }]]
                : [],
              plugins: babelEnv && babelModules ? ["add-module-exports"] : []
            }
          }
        ]
      }
    };
  })
);
