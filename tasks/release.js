'use strict';

// Packages ./build for the current OS (run "npm run prerelease" first).
//   node tasks/release.js --env=production

const projectDir = require('fs-jetpack');
const { getNodeModulesDir, os } = require('./utils');

const tmpDir = projectDir.dir('./tmp', { empty: true });
const releasesDir = projectDir.dir('./releases');
const manifest = projectDir.read('package.json', 'json');
const node_modules_dir = getNodeModulesDir();

const releaseTasks = {
    osx: require('./release_osx'),
    linux: require('./release_linux'),
    windows: require('./release_windows'),
};

Promise.resolve(releaseTasks[os()]({
    manifest,
    node_modules_dir,
    projectDir,
    releasesDir,
    tmpDir
})).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
