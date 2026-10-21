"use strict";

// Generates THIRD-PARTY-NOTICES.txt: the licenses of the software KeyBar includes
// that is neither CryptoTrust's (LICENSE.txt) nor part of this fork.
//
// - Libraries bundled in app/vendor and the NW.js runtime: listed below, with their
//   license texts kept in resources/licenses/.
// - npm packages that are copied into the app: every non-dev package in
//   package-lock.json, with the license file from its folder in node_modules.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LICENSES = path.join(ROOT, "resources", "licenses");
const LINE = "=".repeat(78);

const read = (file) => fs.readFileSync(file, "utf8").trim();

function bundled() {
  const nwVersion = require(path.join(ROOT, "package.json")).devDependencies.nw;
  return [
    {
      name: `NW.js ${nwVersion}`,
      license: "MIT",
      url: "https://nwjs.io",
      note:
        "The runtime KeyBar runs on. NW.js includes Chromium and Node.js; their own\n" +
        "license notices are shipped inside the NW.js framework in the app.",
      text: read(path.join(LICENSES, "nwjs-LICENSE.txt")),
    },
    {
      name: "OpenPGP.js 3.1.2",
      license: "LGPL-3.0",
      url: "https://openpgpjs.org",
      note:
        "Included unmodified as app.nw/vendor/openpgp.min.js; you may replace that file\n" +
        "with another version. Source code: https://github.com/openpgpjs/openpgpjs/tree/v3.1.2\n" +
        "The LGPL-3.0 is printed below; it refers to the GNU GPL-3.0, which is printed\n" +
        "at the end of this file.",
      text: read(path.join(LICENSES, "openpgpjs-LICENSE.txt")),
    },
    {
      name: "FileSaver.js (2014-08-29)",
      license: "MIT",
      url: "https://github.com/eligrey/FileSaver.js",
      text: read(path.join(LICENSES, "FileSaver-LICENSE.txt")),
    },
    {
      name: "nw-boilerplate (external_links.js, window_state.js, darwin_menu.js)",
      license: "MIT",
      url: "https://github.com/szwacz/nw-boilerplate",
      text: read(path.join(LICENSES, "nw-boilerplate-LICENSE.txt")),
    },
  ];
}

function findLicenseFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const file = fs
    .readdirSync(dir)
    .find((name) => /^(licen[cs]e|copying|unlicense)(\.|-|$)/i.test(name));
  return file ? path.join(dir, file) : null;
}

// For packages that state their license in package.json but ship no license file:
// the standard text of that license (SPDX license list), with the author as holder.
function standardLicenseText(license, pkg) {
  const template = license && path.join(LICENSES, "spdx", `${license}.txt`);
  if (!template || !fs.existsSync(template)) {
    return `(The package does not include a license file; its package.json says: ${license || "nothing"}.)`;
  }
  const author = typeof pkg.author === "string" ? pkg.author : (pkg.author && pkg.author.name) || "the package authors";
  return (
    `(The package does not include a license file. Its package.json states "${license}";\n` +
    `the standard ${license} text follows, with the author named in package.json.)\n\n` +
    read(template)
      .replace(/<year>\s*/g, "")
      .replace(/<owner>|<copyright holders>/g, author)
  );
}

function npmPackages(nodeModulesDir) {
  const lock = require(path.join(ROOT, "package-lock.json"));
  return Object.entries(lock.packages)
    .filter(([key, info]) => key && !info.dev && !info.devOptional)
    .map(([key, info]) => {
      const name = key.replace(/^.*node_modules\//, "");
      const dir = path.join(nodeModulesDir, key.replace(/^node_modules\//, ""));
      const licenseFile = findLicenseFile(dir);
      const pkg = fs.existsSync(path.join(dir, "package.json"))
        ? require(path.join(dir, "package.json"))
        : {};
      let license = info.license || pkg.license;
      if (!license && licenseFile && /Permission is hereby granted, free of charge/.test(read(licenseFile))) {
        license = "MIT, per its license file";
      }
      return {
        name: `${name} ${info.version}`,
        license: license || "see below",
        url: `https://www.npmjs.com/package/${name}`,
        text: licenseFile ? read(licenseFile) : standardLicenseText(license, pkg),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function entry(item, i) {
  return [
    LINE,
    `${i}. ${item.name}`,
    `   License: ${item.license}`,
    item.url ? `   ${item.url}` : null,
    LINE,
    item.note ? `${item.note}\n` : null,
    item.text,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function generate(nodeModulesDir = path.join(ROOT, "node_modules")) {
  const manifest = require(path.join(ROOT, "package.json"));
  const items = [...bundled(), ...npmPackages(nodeModulesDir)];

  return [
    `THIRD-PARTY SOFTWARE NOTICES`,
    `${manifest.productName} ${manifest.version}`,
    "",
    `${manifest.productName} includes the software listed below, each under its own license.`,
    "The OnlyKey App code it is based on is covered by LICENSE.txt.",
    "",
    "Contents:",
    ...items.map((item, i) => `  ${i + 1}. ${item.name} (${item.license})`),
    "",
    ...items.map((item, i) => entry(item, i + 1)),
    LINE,
    "GNU GENERAL PUBLIC LICENSE, version 3 (referred to by the LGPL-3.0 above)",
    LINE,
    read(path.join(LICENSES, "GPL-3.0.txt")),
    "",
  ].join("\n");
}

module.exports = { generate };

if (require.main === module) {
  process.stdout.write(generate(process.argv[2]));
}
