/*
 * Release builds: no informational console output.
 *
 * The original OnlyKey App code logs a lot to the developer console. The obvious
 * secrets have been removed from those messages, but as a second line of defence a
 * release build drops console.log/info/debug/dir entirely (warnings and errors are
 * kept). Normally the console goes nowhere, but when the app is started with
 * --enable-logging it would end up in a log file.
 *
 * To get the full log while troubleshooting, start the app with --keybar-debug
 * (or with the environment variable KEYBAR_DEBUG=1).
 *
 * Loaded as the first script of app.html.
 */
(function () {
  "use strict";

  if (typeof nw === "undefined") return;

  const manifest = nw.App.manifest || {};
  const args = [].concat(nw.App.argv || [], nw.App.fullArgv || []);
  const debug =
    args.includes("--keybar-debug") ||
    (typeof process !== "undefined" && process.env && process.env.KEYBAR_DEBUG === "1");

  if (manifest.buildEnv !== "production" || debug) return;

  const noop = function () {};
  ["log", "info", "debug", "dir", "dirxml", "table", "trace"].forEach((method) => {
    try {
      console[method] = noop;
    } catch (e) {
      /* ignore */
    }
  });
})();
