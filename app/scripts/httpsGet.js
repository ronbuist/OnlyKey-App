/*
 * Minimal replacement for the deprecated `request` package, which had several
 * known vulnerabilities (via form-data, tough-cookie, qs, uuid). Only Node's
 * built-in https module is used.
 *
 * It mimics the small part of request's API that OnlyKeyComm.js uses:
 *
 *   const req = httpsGet.get(url, function (err, res, body) {
 *     this.uri.href            // final URL after redirects
 *   });
 *   req.responseContent.body   // response body (set before the callback runs)
 */
"use strict";

const https = require("https");
const { URL } = require("url");

const MAX_REDIRECTS = 10;
const TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // firmware files are well under 1 MB

// The app only downloads from GitHub: the firmware release page (github.com) and
// the release files, which GitHub serves from one of its download hosts. Other
// hosts, including raw.githubusercontent.com (any repository's files), are refused.
const ALLOWED_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.has(hostname);
}

function fetchFollowingRedirects(url, options = {}, redirectsLeft = MAX_REDIRECTS) {
  const allowHost = options.allowHost || isAllowedHost;
  const maxBytes = options.maxBytes || MAX_BODY_BYTES;

  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:") {
      return reject(new Error(`Refusing non-https URL: ${url}`));
    }
    if (!allowHost(target.hostname)) {
      return reject(new Error(`Refusing to download from ${target.hostname}`));
    }

    const req = https.get(target, { headers: { "User-Agent": "OnlyKey-App" } }, (res) => {
      const { statusCode, headers } = res;

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume(); // discard the redirect body
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects for ${url}`));
        const next = new URL(headers.location, target).toString();
        return resolve(fetchFollowingRedirects(next, options, redirectsLeft - 1));
      }

      if (Number(headers["content-length"]) > maxBytes) {
        res.resume();
        return reject(new Error(`Download too large: ${headers["content-length"]} bytes`));
      }

      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > maxBytes) {
          req.destroy(new Error(`Download too large (over ${maxBytes} bytes)`));
        }
      });
      res.on("end", () => resolve({ url: target.toString(), statusCode, body }));
      res.on("error", reject);
    });

    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on("error", reject);
  });
}

function get(url, callback) {
  const req = { uri: { href: url }, responseContent: { body: "", statusCode: 0 } };

  fetchFollowingRedirects(url).then(
    (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      req.uri = { href: res.url };
      // like a failed download: no body on HTTP errors (e.g. 404)
      req.responseContent = { body: ok ? res.body : "", statusCode: res.statusCode };
      callback.call(req, null, req.responseContent, req.responseContent.body);
    },
    (err) => callback.call(req, err)
  );

  return req;
}

module.exports = { get, fetchFollowingRedirects, isAllowedHost };
