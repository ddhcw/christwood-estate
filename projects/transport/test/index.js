'use strict';
// Entry point so that `node --test test/` works on every Node version: Node 24
// resolves the directory argument as a module (test/index.js), older versions
// scan the folder. Either way the suites below run.
require('./gps-setup.test.js');
require('./gps-auth.test.js');
require('./gps-endpoints.test.js');
require('./gps-watchdog.test.js');
require('./gps-events.test.js');
