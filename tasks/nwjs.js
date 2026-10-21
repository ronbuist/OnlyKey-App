"use strict";

// Locate the NW.js runtime that the `nw` npm package downloaded.
//
// Older `nw` packages (< 0.80) put it in node_modules/nw/nwjs/.
// Newer ones put it in node_modules/nw/nwjs[-sdk]-v<version>-<platform>-<arch>/
// so that several platforms / architectures can live side by side.
//
// The architecture defaults to the machine running the build (so building on an
// Apple Silicon Mac gives an arm64 app). Override with NWJS_ARCH=x64 or arm64;
// use the same value when running `npm install` so that runtime gets downloaded.

const fs = require("fs");
const path = require("path");

const PLATFORMS = { darwin: "osx", linux: "linux", win32: "win" };
const EXECUTABLES = {
  osx: "nwjs.app/Contents/MacOS/nwjs",
  linux: "nw",
  win: "nw.exe",
};

function targetArch() {
  return (
    process.env.NWJS_ARCH ||
    process.env.npm_config_nwjs_process_arch ||
    process.arch
  );
}

function runtimeDir(nodeModulesDir = "node_modules") {
  const nwPackageDir = path.resolve(nodeModulesDir, "nw");
  const legacyDir = path.join(nwPackageDir, "nwjs");
  if (fs.existsSync(legacyDir)) return legacyDir;

  const platform = PLATFORMS[process.platform];
  const arch = targetArch();
  const version = require(path.join(nwPackageDir, "package.json")).version.replace(/-sdk$/, "");
  const candidates = fs
    .readdirSync(nwPackageDir)
    .filter((name) => /^nwjs(-sdk)?-v/.test(name))
    .filter((name) => name.endsWith(`-v${version}-${platform}-${arch}`))
    // prefer the normal build over the sdk build for releases
    .sort((a, b) => a.includes("-sdk-") - b.includes("-sdk-"));

  if (!candidates.length) {
    throw new Error(
      `NW.js ${version} runtime for ${platform}-${arch} not found in ${nwPackageDir}. ` +
        `Run "npm install" (set NWJS_ARCH=${arch} if you are building for another architecture).`
    );
  }
  return path.join(nwPackageDir, candidates[0]);
}

function executable(nodeModulesDir = "node_modules") {
  return path.join(runtimeDir(nodeModulesDir), EXECUTABLES[PLATFORMS[process.platform]]);
}

module.exports = { runtimeDir, executable, targetArch };
