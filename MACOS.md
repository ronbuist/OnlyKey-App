# KeyBar on macOS: menu-bar app and Apple Silicon build

This branch changes how the app behaves on macOS:

- **No Dock icon, no window at startup.** The app lives in the menu bar only. The main
  window starts hidden (`"show": false`) and `app/scripts/menubar.js` calls NW.js's
  `setShowInTaskbar(false)`, which removes the Dock icon while the app runs. NW.js opens
  `app.html` directly (`"main": "app.html"`); `app/app.js` is only used by the Chrome app. Don't use
  `LSUIElement` in `Info.plist` for this: Chromium then crashes at startup
  ("icudtl.dat not found in bundle"), and the release script refuses to build it.
- **Everything from the menu-bar icon:** connection status, *Unlock OnlyKey…*,
  *Open KeyBar*, direct shortcuts to Slots, Keys, Backup / Restore, Firmware,
  Preferences, Advanced, Tools and Setup, the existing app settings, and *Quit*.
- **Closing the window hides it.** The app keeps running in the background so it keeps
  setting the key's clock (needed for TOTP codes) every time you plug it in.
  `Cmd+Q` or *Quit KeyBar* in the menu really quits. *About KeyBar* shows the version,
  that KeyBar is not endorsed by CryptoTrust, and the license.
- **Small unlock window.** Plugging in a locked OnlyKey opens a compact window just for
  the PIN (OnlyKey DUO), or a reminder to enter the PIN on the key (original OnlyKey).
  It closes by itself once the key is unlocked. *Not now* dismisses it until the next
  time you plug the key in; *Unlock OnlyKey…* in the menu brings it back.
- If the app needs to ask something (e.g. "new firmware available"), the main window
  comes to the front first, so the question is never hidden.
- **Native Apple Silicon (arm64) build**, based on NW.js 0.117.0.
- **Installs next to the official app.** This build is called *KeyBar* (versions 0.1.x were
  called *OnlyKey Menu Bar*; KeyBar removes their login item), with
  its own bundle ID, settings folder and login item, so it doesn't replace or interfere
  with the official *OnlyKey App* (its own name and icon, too). Only run one of the two at a time, because both
  want to talk to the key.

Windows and Linux behave as before (window at startup, tray menu with settings only).

## Building on your Mac

Requirements: macOS 11 or later, the Xcode command line tools (`xcode-select --install`;
needed for `codesign` and `lipo`), and **Node.js 22.12 or later**.

About the Node.js version: 22.12 is the minimum, because the NW.js download tool needs it
(`package.json` says so in `engines`, so npm warns on older versions). KeyBar has been built
and tested with **Node.js 22 LTS** (22.23), which is the recommended version. All packages
also accept Node.js 24 and 26, but builds with those have not been tested yet.

```sh
git clone <your fork> OnlyKey-App
cd OnlyKey-App
npm install          # downloads the NW.js runtime for this Mac's architecture
npm start            # optional: try it in development mode (shows a Dock icon)
npm run release      # runs "prerelease" first (clean install + production build)
```

`npm run release` produces:

- `releases/KeyBar.app` – drag it to `/Applications`
- `releases/KeyBar_0.2.0_arm64.dmg` – a disk image with the app, a shortcut to
  Applications and `LICENSE.txt`, built with macOS's own `hdiutil`. The build asks Finder
  to arrange the window; the first time, macOS may ask whether the terminal may control
  Finder (if you decline, the DMG gets the default layout)

The release step checks that the executable really is `arm64` and stops if it isn't.

To build an Intel version on an Apple Silicon Mac instead, remove `node_modules` and
`release_node_modules` and run every command above with `NWJS_ARCH=x64` set.

### Signing

The release is ad-hoc signed (`codesign --sign -`), which is what Apple Silicon needs to
run the app on the Mac that built it. Because you built it yourself, macOS does not put
it in quarantine and should open it without warnings. If you copy the app to another
Mac, macOS blocks it the first time: allow it under System Settings → Privacy & Security
→ *Open Anyway*.

The app and all its NW.js helper apps are signed with the **Hardened Runtime**, like the
official OnlyKey App: other programs can't inject code into KeyBar or attach a debugger
to it. The entitlements (`resources/osx/entitlements.plist`) are identical to the official
app's; they allow what NW.js's JavaScript engine needs. The build checks that every part
got the Hardened Runtime. To sign without it (e.g. while troubleshooting):
`HARDENED_RUNTIME=0 npm run release`.

Compared with the official app, what an ad-hoc signature can't provide is a Developer ID
(proof of who made it) and Apple's notarization. With an Apple Developer ID you can sign
it properly: `CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" npm run release`
(notarization is not set up).

To check a build:

    codesign -dv --verbose=4 /Applications/KeyBar.app 2>&1 | grep -E "Signature|flags|Runtime"

shows `Signature=adhoc` and `flags=0x10002(adhoc,runtime)`.

### After installing

- The first time, start the app from `/Applications`. It turns on
  *App Settings → Auto-launch app on system login* by default, so it is always there
  when you plug in the key. On macOS this is a launch agent
  (`~/Library/LaunchAgents/KeyBar.plist`), not a login item, so no
  "control System Events" permission is needed.
- Settings are separate from the official app, so preferences you set there don't carry
  over. If the official app is set to start at login, turn that off (in the official
  app, or in System Settings → General → Login Items) so only one copy runs.

## Dependencies and security

To keep known vulnerabilities out (`npm audit`), this branch:

- replaces the abandoned `request` package with a small helper on Node's built-in
  `https` module (`app/scripts/httpsGet.js`), used for the firmware update check;
- builds with plain Node.js scripts (`tasks/build.js`, `tasks/release.js`) instead of
  gulp, and the DMG with `hdiutil` instead of `appdmg`;
- drops unused packages (`gulp-sourcemaps`, `nw-dev`, `tree-kill`, `eslint`, `json`) and
  replaces the old `q` promise library with native promises, so `npm install` shows no
  deprecation warnings;
- makes `nw` (the NW.js download helper) a build-time dependency only, so the app itself
  contains just `auto-launch`, `sshpk`, `js-sha256` and their sub-packages;
- generates `THIRD-PARTY-NOTICES.txt` with the licenses of everything bundled, shown in
  *About KeyBar*;
- removes the automatic app update check (`nw-autoupdater`): it checked the official
  CryptoTrust releases, which would replace this build. The firmware update check stays.

`npm audit` reports 0 vulnerabilities.

## If the key isn't detected

This version moves from NW.js 0.71 to 0.117. The app talks to the key through NW.js's
`chrome.hid` API, which is still part of NW.js, but this upgrade has not yet been tested
with a real key on a Mac. If the key isn't found:

- Install the NW.js SDK build, which has developer tools:
  `rm -rf node_modules && NWJS_BUILD_TYPE=sdk npm install`, then `npm start`,
  open the window from the menu bar, right-click → *Inspect* and check the console.
- Or try another NW.js version: change `"nw"` in `package.json`, run
  `rm -rf node_modules && npm install`, and try again.
