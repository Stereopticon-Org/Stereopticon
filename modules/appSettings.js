'use strict';
/**
 * modules/appSettings.js
 *
 * Small settings that the main process needs (the renderer keeps its own UI
 * preferences in localStorage). Stored at ~/.stereopticon/settings.json.
 *
 *   wiz3dChannel     'stable' | 'beta'   which wiz3D releases count as "latest"
 *   detailedLogging  boolean             debug lines in Stereopticon's log and
 *                                        wiz3D's own verbose logs at launch
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const BASE = process.env.STEREOPTICON_HOME || path.join(os.homedir(), '.stereopticon');
const FILE = path.join(BASE, 'settings.json');

const DEFAULTS = { wiz3dChannel: 'stable', detailedLogging: false };

function readAll() {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
    catch { return { ...DEFAULTS }; }
}

function get(key) { return readAll()[key]; }

function set(values) {
    const next = { ...readAll(), ...values };
    if (!['stable', 'beta'].includes(next.wiz3dChannel)) next.wiz3dChannel = 'stable';
    next.detailedLogging = !!next.detailedLogging;
    fs.mkdirSync(BASE, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
    return next;
}

module.exports = { readAll, get, set, BASE };
