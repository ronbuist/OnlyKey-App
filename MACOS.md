# OnlyKey App on macOS: menu-bar mode and Apple Silicon build

This branch changes how the app behaves on macOS:

- **No Dock icon, no window at startup.** The app lives in the menu bar only
  (`LSUIElement` in `resources/osx/Info.plist`, `"show": false` in `package.json`).
- **Everything from the menu-bar icon:** connection status, *Unlock OnlyKey…*,
  *Open OnlyKey App*, direct shortcuts to Slots, Keys, Backup / Restore, Firmware,
  Preferences, Advanced, Tools and Setup, the existing app settings, and *Quit*.
- **Closing the window hides it.** The app keeps running in the background so it keeps
  setting the key's clock (needed for TOTP codes) every time you plug it in.
  `Cmd+Q` or *Quit OnlyKey App* in the menu really quits.
- **Small unlock window.** Plugging in a locked OnlyKey opens a compact window just for
  the PIN (OnlyKey DUO), or a reminder to enter the PIN on the key (original OnlyKey).
  It closes by itself once the key is unlocked. *Not now* dismisses it until the next
  time you plug the key in; *Unlock OnlyKey…* in the menu brings it back.
- If the app needs to ask something (e.g. "new firmware available"), the main window
  comes to the front first, so the question is never hidden.
- **Native Apple Silicon (arm64) build**, based on NW.js 0.117.0.

- **Installs next to the official app.** This build is called *OnlyKey Menu Bar*, with
  its own bundle ID, settings folder and login item, so it doesn't replace or interfere
  with the official *OnlyKey App*. Only run one of the two at a time, because both
  want to talk to the key.

Windows and Linux behave as before (window at startup, tray menu with settings only).

## Building on your Mac

Requirements: macOS 11 or later, Node.js 20 or later, and the Xcode command line tools
(`xcode-select --install`; needed for `codesign`, `lipo` and the DMG builder).

```sh
git clone <your fork> OnlyKey-App
cd OnlyKey-App
git checkout macos-menubar-arm64
npm install          # downloads the NW.js runtime for this Mac's architecture
npm start            # optional: try it in development mode (shows a Dock icon)
npm run prerelease
npm run release
```

`npm run release` produces:

- `releases/OnlyKey Menu Bar.app` – drag it to `/Applications`
- `releases/OnlyKey-MenuBar_5.5.0_arm64.dmg` – if the optional `appdmg` package installed

The release step checks that the executable really is `arm64` and stops if it isn't.

To build an Intel version on an Apple Silicon Mac instead, remove `node_modules` and
`release_node_modules` and run every command above with `NWJS_ARCH=x64` set.

### Signing

The release is ad-hoc signed (`codesign --sign -`), which is what Apple Silicon needs to
run the app on the Mac that built it. Because you built it yourself, macOS does not put
it in quarantine and should open it without warnings. If you copy the app to another
Mac, macOS will warn the first time: right-click it and choose *Open*.

With an Apple Developer ID you can sign it properly:
`CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" npm run release`.
(Distributing it publicly would also need the hardened runtime and notarization, which
this branch does not set up.)

### After installing

- The first time, start the app from `/Applications`. Turn on
  *App Settings → Auto-launch app on system login* in the menu-bar menu so it is always
  there when you plug in the key.
- *App Settings → Automatically check for app updates* points at the official
  CryptoTrust releases, which would replace this build. You may want to turn it off.
- Settings are separate from the official app, so preferences you set there don't carry
  over. If the official app is set to start at login, turn that off (in the official
  app, or in System Settings → General → Login Items) so only one copy runs.

## If the key isn't detected

This version moves from NW.js 0.71 to 0.117. The app talks to the key through NW.js's
`chrome.hid` API, which is still part of NW.js, but this upgrade has not yet been tested
with a real key on a Mac. If the key isn't found:

- Install the NW.js SDK build, which has developer tools:
  `rm -rf node_modules && NWJS_BUILD_TYPE=sdk npm install`, then `npm start`,
  open the window from the menu bar, right-click → *Inspect* and check the console.
- Or try another NW.js version: change `"nw"` in `package.json`, run
  `rm -rf node_modules && npm install`, and try again.
