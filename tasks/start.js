'use strict';

// Development mode: build, rebuild on changes, and run the app with NW.js.
//   npm start

const childProcess = require('child_process');
const nwjs = require('./nwjs');
const { build, watch } = require('./build');

build();
watch();

const app = childProcess.spawn(nwjs.executable(), ['./build'], { stdio: 'inherit' });
// User closed the app: stop watching and exit.
app.on('close', () => process.exit());
