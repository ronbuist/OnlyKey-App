'use strict';

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const jetpack = require('fs-jetpack');
const { replace } = require('./utils');
const nwjs = require('./nwjs');

let projectDir;
let releasesDir;
let tmpDir;
let finalAppDir;
let manifest;
let node_modules_dir;
let arch;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const init = function (params={}) {
    projectDir = params.projectDir || jetpack;
    tmpDir = params.tmpDir || projectDir.dir('./tmp', { empty: true });
    releasesDir = params.releasesDir || projectDir.dir('./releases');
    manifest = params.manifest || projectDir.read('package.json', 'json');
    node_modules_dir = params.node_modules_dir || 'node_modules';
    arch = nwjs.targetArch();

    finalAppDir = tmpDir.cwd(manifest.productName + '.app');
    return Promise.resolve();
};

const copyRuntime = function () {
    const runtimeApp = path.join(nwjs.runtimeDir() /* build tool, in ./node_modules */, 'nwjs.app');
    console.log(`Copying NW.js runtime from ${runtimeApp}...`);

    // ditto keeps the framework symlinks and extended attributes intact
    run('ditto', [runtimeApp, finalAppDir.path()]);

    // Remove the localized strings, otherwise the application name shows up
    // as 'nwjs'. Thanks to https://github.com/nwjs-community/nw-builder/
    finalAppDir.find('Contents/Resources', { matching: '*.lproj/*', files: true, directories: false })
        .forEach((file) => finalAppDir.remove(file));

    return Promise.resolve();
};

const copyBuiltApp = function () {
    console.log(`Copying /build contents into app.nw`);
    return projectDir.copyAsync('build', finalAppDir.path('Contents/Resources/app.nw'));
};

const plistToJson = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));

const prepareOsSpecificThings = function () {
    console.log('Doing OSX-specific things...');

    // Info.plist: keep NW.js's own Info.plist (it has keys Chromium needs) and
    // overlay our keys from resources/osx/Info.plist on top of it.
    let info = projectDir.read('resources/osx/Info.plist');
    info = replace(info, {
        productName: manifest.productName,
        version: manifest.version
    });
    tmpDir.write('Info.overlay.plist', info);

    const targetPlist = finalAppDir.path('Contents/Info.plist');
    const overlay = plistToJson(tmpDir.path('Info.overlay.plist'));
    if (overlay.LSUIElement || overlay.LSBackgroundOnly) {
        // Chromium treats a bundle with LSUIElement as one of its helper processes,
        // looks for its framework in the wrong place and aborts ("icudtl.dat not found").
        // The Dock icon is hidden at runtime instead (show_in_taskbar: false).
        throw new Error('Do not set LSUIElement / LSBackgroundOnly in resources/osx/Info.plist: NW.js crashes at startup.');
    }
    Object.keys(overlay).forEach((key) => {
        const value = overlay[key];
        const type = typeof value === 'boolean' ? 'bool' : 'string';
        run('plutil', ['-replace', key, `-${type}`, String(value), targetPlist]);
    });
    tmpDir.remove('Info.overlay.plist');

    // Icon
    projectDir.copy('resources/keybar/icon.icns', finalAppDir.path('Contents/Resources/icon.icns'), { overwrite: true });

    // Rename executable, so it looks nice in the installer
    jetpack.rename(finalAppDir.path('Contents/MacOS/nwjs'), manifest.productName);

    return Promise.resolve();
};

const checkArchitecture = function () {
    const exe = finalAppDir.path('Contents/MacOS', manifest.productName);
    const archs = run('lipo', ['-archs', exe]);
    console.log(`Executable architecture(s): ${archs}`);
    if (!archs.split(/\s+/).includes(arch)) {
        throw new Error(`Expected a ${arch} build, but the NW.js runtime is "${archs}". ` +
            `Delete node_modules and run "npm install" again (NWJS_ARCH=${arch}).`);
    }
    return Promise.resolve();
};

const signApp = function () {
    // Changing Info.plist and adding app.nw invalidates NW.js's signature, and
    // Apple Silicon Macs refuse to start unsigned arm64 code. Re-sign the bundle:
    // ad-hoc ("-") by default, or with your Developer ID via CODESIGN_IDENTITY.
    //
    // With the Hardened Runtime (like the official OnlyKey App), so other programs
    // can't inject code into KeyBar or attach a debugger to it. The entitlements in
    // resources/osx/entitlements.plist are the same as the official app's.
    // Build with HARDENED_RUNTIME=0 to sign without it.
    const identity = process.env.CODESIGN_IDENTITY || '-';
    const hardened = process.env.HARDENED_RUNTIME !== '0';
    const args = ['--force', '--deep', '--sign', identity];
    if (hardened) {
        args.push('--options', 'runtime', '--entitlements', projectDir.path('resources/osx/entitlements.plist'));
    }
    console.log(`Code signing with identity "${identity}"${hardened ? ', Hardened Runtime' : ' (no Hardened Runtime)'}...`);
    run('codesign', [...args, finalAppDir.path()]);
    run('codesign', ['--verify', '--deep', '--strict', finalAppDir.path()]);

    if (hardened) {
        // check that the app and every helper app really got the runtime flag
        // The framework's version folder is reachable via several symlinks
        // (Versions/<v>, Versions/Current, top-level Helpers), so the same helper is
        // found more than once: keep each real path only once.
        const fs = require('fs');
        const helpers = [...new Set(
            finalAppDir.find('Contents/Frameworks', { matching: '**/Helpers/*.app', directories: true, files: false })
                .map((h) => fs.realpathSync(finalAppDir.path(h)))
        )];
        [finalAppDir.path(), ...helpers].forEach((bundle) => {
            // codesign -dv writes its details to stderr
            const details = spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8' }).stderr || '';
            if (!/flags=0x[0-9a-f]*\(.*runtime.*\)/.test(details)) {
                throw new Error(`Hardened Runtime is not set on ${bundle}`);
            }
        });
        console.log(`Hardened Runtime set on the app and ${helpers.length} helper apps: ` +
            helpers.map((h) => path.basename(h, '.app')).join(', '));
    }
    return Promise.resolve();
};

const copyAppToReleases = function () {
    const target = releasesDir.path(`${manifest.productName}.app`);
    releasesDir.remove(`${manifest.productName}.app`);
    run('ditto', [finalAppDir.path(), target]);
    console.log('App ready!', target);
    return Promise.resolve();
};

// DMG window layout: a compact window with the app on the left, the
// Applications shortcut on the right and the license centred below them
// (Finder coordinates, icon centres).
const DMG_WINDOW = { width: 480, height: 380 };
const DMG_ICON_SIZE = 96;
const DMG_APP_POSITION = [130, 110];
const DMG_APPLICATIONS_POSITION = [350, 110];
const DMG_LICENSE_POSITION = [240, 255];

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Let Finder arrange the mounted (writable) image once; Finder stores the result
// in the image's hidden .DS_Store. Needs permission for the terminal to control
// Finder (macOS asks the first time). Returns false if that isn't possible.
// An AppleScript string literal: quotes and backslashes escaped, so a path or name
// can never break out of the string.
const asString = (value) => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const layoutDmgWindow = function (mountPoint, appName) {
    const [x, y] = [200, 160]; // where the window opens on screen
    const script = `
        tell application "Finder"
            set dmgFolder to (POSIX file ${asString(mountPoint)} as alias)
            open dmgFolder
            set w to container window of dmgFolder
            set current view of w to icon view
            set toolbar visible of w to false
            set statusbar visible of w to false
            set bounds of w to {${x}, ${y}, ${x + DMG_WINDOW.width}, ${y + DMG_WINDOW.height}}
            set opts to icon view options of w
            set arrangement of opts to not arranged
            set icon size of opts to ${DMG_ICON_SIZE}
            set text size of opts to 13
            set position of item ${asString(appName)} of dmgFolder to {${DMG_APP_POSITION.join(', ')}}
            set position of item "Applications" of dmgFolder to {${DMG_APPLICATIONS_POSITION.join(', ')}}
            set position of item "LICENSE.txt" of dmgFolder to {${DMG_LICENSE_POSITION.join(', ')}}
            update dmgFolder without registering applications
            delay 1
            close w
        end tell`;
    try {
        run('osascript', ['-e', script]);
        return true;
    } catch (err) {
        console.warn('Could not arrange the DMG window with Finder (allow the terminal to ' +
            'control Finder in System Settings > Privacy & Security > Automation to get the ' +
            'custom layout). Using the default layout.\n' + (err.stderr || err.message));
        return false;
    }
};

const detach = function (mountPoint) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            run('hdiutil', attempt < 5 ? ['detach', mountPoint] : ['detach', '-force', mountPoint]);
            return;
        } catch (err) {
            sleepSync(1000); // Finder may still be busy with the volume
        }
    }
};

const packToDmgFile = function () {
    // Built with macOS's own hdiutil: a disk image with the app and a shortcut to
    // /Applications to drag it onto. (The appdmg package used before had known
    // vulnerabilities and native dependencies that don't always build.)
    const dmgName = `${manifest.name}_${manifest.version}_${arch}.dmg`;
    const appName = `${manifest.productName}.app`;
    const staging = tmpDir.dir('dmg', { empty: true });
    run('ditto', [finalAppDir.path(), staging.path(appName)]);
    run('ln', ['-s', '/Applications', staging.path('Applications')]);
    // The license must accompany binary distributions (LICENSE.txt, clause 2).
    projectDir.copy('LICENSE.txt', staging.path('LICENSE.txt'), { overwrite: true });

    console.log('Packaging to DMG file...');

    // 1. writable image with some room for Finder's .DS_Store
    const sizeMb = parseInt(run('du', ['-sm', staging.path()]).split(/\s+/)[0], 10) + 20;
    const rwDmg = tmpDir.path('rw.dmg');
    run('hdiutil', ['create', '-volname', manifest.productName, '-srcfolder', staging.path(),
        '-fs', 'HFS+', '-format', 'UDRW', '-size', `${sizeMb}m`, '-ov', rwDmg]);

    // 2. mount it at a private mount point and let Finder arrange the window
    const mountPoint = tmpDir.path('dmg-mount');
    tmpDir.dir('dmg-mount', { empty: true });
    run('hdiutil', ['attach', rwDmg, '-readwrite', '-noverify', '-noautoopen',
        '-mountpoint', mountPoint]);
    try {
        if (layoutDmgWindow(mountPoint, appName)) console.log('DMG window arranged.');
        run('sync', []);
    } finally {
        detach(mountPoint);
    }

    // 3. compress into the final read-only image
    releasesDir.remove(dmgName);
    run('hdiutil', ['convert', rwDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9',
        '-o', releasesDir.path(dmgName)]);
    tmpDir.remove('rw.dmg');
    console.log('DMG file ready!', releasesDir.path(dmgName));
    return Promise.resolve();
};

const cleanClutter = function () {
    return tmpDir.removeAsync('.');
};

module.exports = function (params) {
    return init(params)
    .then(copyRuntime)
    .then(copyBuiltApp)
    .then(prepareOsSpecificThings)
    .then(checkArchitecture)
    .then(signApp)
    .then(copyAppToReleases)
    .then(packToDmgFile)
    .then(cleanClutter);
};
