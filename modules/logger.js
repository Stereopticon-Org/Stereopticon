'use strict';
/**
 * modules/logger.js
 *
 * Stereopticon's own log, always on: one file a day at
 * ~/.stereopticon/logs/stereopticon-YYYY-MM-DD.log, kept for 14 days.
 *
 * Warnings and errors from the main process and the window are always
 * written, as are the lines Stereopticon logs on purpose (installs, launches,
 * wiz3D downloads). With Settings → Detailed logging on, every console line
 * is written too.
 */

const fs   = require('fs');
const path = require('path');
const util = require('util');
const { BASE } = require('./appSettings');
const appSettings = require('./appSettings');

const LOG_DIR   = path.join(BASE, 'logs');
const KEEP_DAYS = 14;

let detailed = false;
let installed = false;

function day(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function logFile(d) { return path.join(LOG_DIR, `stereopticon-${day(d)}.log`); }

function write(level, source, args) {
    const text = args.map(a => typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 })).join(' ');
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${text}\n`;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(logFile(), line);
    } catch { /* logging must never break the app */ }
}

/** Log a line regardless of the detailed setting. */
function info(source, ...args)  { write('info', source, args); }
function warn(source, ...args)  { write('warn', source, args); }
function error(source, ...args) { write('error', source, args); }

/** A line from the window (sent over IPC). Debug lines only when detailed. */
function fromRenderer(level, args) {
    if ((level === 'log' || level === 'debug' || level === 'info') && !detailed) return;
    write(level === 'log' ? 'debug' : level, 'window', Array.isArray(args) ? args : [args]);
}

function setDetailed(on) { detailed = !!on; }
function isDetailed()    { return detailed; }

function pruneOld() {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    try {
        for (const f of fs.readdirSync(LOG_DIR)) {
            const full = path.join(LOG_DIR, f);
            if (/^stereopticon-.*\.log$/.test(f) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
        }
    } catch { /* no folder yet */ }
}

/**
 * Copy main-process console output into the log: warnings and errors
 * always, everything else when detailed logging is on.
 */
function install() {
    if (installed) return;
    installed = true;
    detailed = !!appSettings.get('detailedLogging');
    pruneOld();
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            orig(...args);
            if (level === 'warn' || level === 'error' || detailed) write(level === 'log' ? 'debug' : level, 'main', args);
        };
    }
    process.on('uncaughtException', e => write('error', 'main', ['Uncaught exception:', e?.stack || e]));
    process.on('unhandledRejection', e => write('error', 'main', ['Unhandled rejection:', e?.stack || e]));
}

/** The newest log files, newest first. */
function recentLogFiles(count = 2) {
    try {
        return fs.readdirSync(LOG_DIR)
            .filter(f => /^stereopticon-.*\.log$/.test(f))
            .sort().reverse().slice(0, count)
            .map(f => path.join(LOG_DIR, f));
    } catch { return []; }
}

module.exports = { install, info, warn, error, fromRenderer, setDetailed, isDetailed, recentLogFiles, LOG_DIR };
