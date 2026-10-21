"use strict";

// Builds the app into ./build. Plain Node.js; this used to be a gulp task, but
// all it does is copy files and write package.json, and gulp's dependency tree
// had known vulnerabilities.
//
//   node tasks/build.js [--env=development|production|test|chrome] [--watch]

const fs = require("fs");
const path = require("path");
const jetpack = require("fs-jetpack");
const argv = require("yargs").argv;

const { getEnvName, getNodeModulesDir } = require("./utils");

const rootDir = jetpack.cwd(path.join(__dirname, ".."));
const appDir = rootDir.cwd("app");
const destDir = rootDir.cwd("build");

function build() {
  const env = getEnvName();
  const isChrome = env === "chrome";
  let manifest = rootDir.read(isChrome ? "manifest.json" : "package.json", "json");

  // clean
  destDir.dir(".", { empty: true });

  // app files: scripts, html, images, stylesheets, vendor
  appDir.copy(".", destDir.path(), {
    overwrite: true,
    matching: ["scripts/**/*.js", "*.js", "*.html", "images/**/*", "stylesheets/**/*", "vendor/**/*"],
  });

  rootDir.copy("manifest.json", destDir.path("manifest.json"), { overwrite: true });
  rootDir.copy("resources/keybar/keybar_128.png", destDir.path("icon.png"), { overwrite: true });
  rootDir.copy("LICENSE.txt", destDir.path("LICENSE.txt"), { overwrite: true });

  if (isChrome) {
    console.log("Copying resources/onlykey_logo_*.png for Chrome extension...");
    rootDir.find("resources", { matching: "onlykey_logo_*.png" }).forEach((file) =>
      rootDir.copy(file, destDir.path(file), { overwrite: true })
    );
  }

  if (env === "production") {
    console.log(`Copying node_modules from ${getNodeModulesDir()}...`);
    rootDir.copy(getNodeModulesDir(), destDir.path("node_modules"), {
      matching: ["!nw/**/*"],
      overwrite: true,
    });
  }

  // package.json adjustments per environment
  switch (env) {
    case "production":
      // Hide dev toolbar if doing a release.
      manifest.window.toolbar = false;
      break;
    case "test":
      // Separate name, so NW.js keeps cookies/localStorage in a separate place.
      manifest.name += "-test";
      break;
    case "development":
      manifest.name += "-dev";
      break;
  }
  destDir.write("package.json", manifest);

  console.log(`Build (${env}) ready in ${destDir.path()}`);
}

function watch() {
  // Rebuild when something in app/ or the manifests changes.
  let timer;
  const rebuild = (what) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        console.log(`Changed: ${what}, rebuilding...`);
        build();
      } catch (err) {
        console.error(err);
      }
    }, 200);
  };
  fs.watch(appDir.path(), { recursive: true }, (event, file) => rebuild(file));
  ["package.json", "manifest.json"].forEach((file) =>
    fs.watch(rootDir.path(file), () => rebuild(file))
  );
  console.log("Watching app/ for changes...");
}

module.exports = { build, watch };

if (require.main === module) {
  build();
  if (argv.watch) watch();
}
