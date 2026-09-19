#!/usr/bin/env node
'use strict';

const { main } = require('../lib/charterleaf.js');

process.exitCode = main();
