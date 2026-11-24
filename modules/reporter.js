'use strict';
/**
 * modules/reporter.js
 *
 * "Report a result" from a game page, or "Report a problem" from Settings.
 *
 * Builds a zip under ~/.stereopticon/reports/ holding a short report, system
 * details, Stereopticon's recent log, and the wiz3D logs and config files
 * found next to the game's .exe. Then returns a GitHub "new issue" link with
 * the report pre-filled, for the user to open, read and submit (attaching
 * the zip). Nothing is sent anywhere by Stereopticon itself.
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');
const { BASE } = require('./appSettings');
const logger = require('./logger');

const REPORT_DIR = path.join(BASE, 'reports');

// Game results go to stereopticon.org's "Game test report" form (approved
// reports update the site's compatibility list); problems with the app go to
// Stereopticon's issue tracker.
const REPOS = { game: 'Stereopticon-Org/stereopticon.org', app: 'Stereopticon-Org/Stereopticon' };

const OUTCOMES = {
    working:   'Working',
    mostly:    'Mostly working',
    partial:   'Partial',
    broken:    'Not working (no 3D or broken 3D)',
    no_start:  'Not working (game does not start or crashes)',
};
// The website form's "Result" options.
const SITE_RESULT = { working: 'Working', mostly: 'Mostly working', partial: 'Partial', broken: 'Not working', no_start: 'Not working' };
// Stereopticon output ids → the form's "Output mode" options.
const SITE_OUTPUT = {
    sr_weave: 'SRWeave', sbs: 'HalfSBS', sbs_half: 'HalfSBS', sbs_full: 'FullSBS',
    tab: 'HalfTAB', tab_half: 'HalfTAB', tab_full: 'FullTAB', anaglyph: 'Anaglyph', anaglyph_red_cyan: 'Anaglyph',
    interleaved: 'RowIL', interleaved_row: 'RowIL', interlaced: 'RowIL', interleaved_col: 'ColumnIL',
    interleaved_column: 'ColumnIL', interleaved_checkerboard: 'Checker',
};
// Installed wiz3D folder → the form's "API" option.
function siteApi(variant) {
    const v = String(variant || '');
    if (/^HD3D/i.test(v)) return 'HD3D';
    if (/OpenGL/i.test(v)) return 'OpenGL';
    if (/DX10-11|DX10|DX11/i.test(v)) return 'DX10/11';
    const m = /DX(7|8|9)/i.exec(v);
    return m ? `DX${m[1]}` : 'Not sure';
}

/** Link to the website's report form with every field we know filled in. */
function siteReportUrl(ctx, rec, sys, zipName) {
    const notes = [(ctx.notes || '').trim(),
        ctx.outcome === 'no_start' ? 'The game does not start or crashes.' : '',
        `Reported from Stereopticon ${sys.stereopticon}. Logs: ${zipName} (drag it into this box to attach it).`,
    ].filter(Boolean).join('\n\n');
    const fields = {
        template: 'compat-report.yml',
        title:    `[Compat] ${ctx.game?.title || ''}`,
        game:     ctx.site_name || ctx.game?.title || '',
        version:  String(rec.wiz3dVersion || '').replace(/^v/, ''),
        folder:   rec.wiz3dVariant || '',
        api:      siteApi(rec.wiz3dVariant),
        output:   SITE_OUTPUT[ctx.output] || '',
        display:  [ctx.display, sys.gpu].filter(Boolean).join(', '),
        result:   SITE_RESULT[ctx.outcome] || '',
        notes,
    };
    const q = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `https://github.com/${REPOS.game}/issues/new?${q}`;
}

const MAX_LOG_BYTES  = 4 * 1024 * 1024;    // per file; the tail is kept
const GAME_LOG_DAYS  = 7;
const URL_BODY_LIMIT = 5500;               // GitHub rejects very long URLs

function stamp(d = new Date()) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

function tail(file, maxBytes = MAX_LOG_BYTES) {
    const size = fs.statSync(file).size;
    if (size <= maxBytes) return fs.readFileSync(file);
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, size - maxBytes);
        return Buffer.concat([Buffer.from(`[... first ${size - maxBytes} bytes cut ...]\n`), buf]);
    } finally { fs.closeSync(fd); }
}

function gpuNames() {
    return new Promise(resolve => {
        execFile('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command',
             '(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + " (driver " + $_.DriverVersion + ")" }) -join "; "'],
            { timeout: 8000, windowsHide: true },
            (err, out) => resolve(err ? 'unknown' : String(out).trim() || 'unknown'));
    });
}

async function systemInfo(appVersion) {
    return {
        stereopticon: appVersion || '',
        windows:      `${os.version?.() || 'Windows'} ${os.release()} (${os.arch()})`,
        cpu:          os.cpus()?.[0]?.model?.trim() || 'unknown',
        memory:       `${Math.round(os.totalmem() / 2 ** 30)} GB`,
        gpu:          await gpuNames(),
    };
}

// wiz3D's logs and configs next to the game exe (only recent logs).
function gameFiles(installDir) {
    if (!installDir || !fs.existsSync(installDir)) return [];
    const cutoff = Date.now() - GAME_LOG_DAYS * 24 * 60 * 60 * 1000;
    const out = [];
    for (const name of fs.readdirSync(installDir)) {
        const full = path.join(installDir, name);
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile()) continue;
        const isLog    = /\.(log|txt)$/i.test(name) && /wiz3d|proxy|stereo|hd3d|nvdirect|3dvision|opengl|s3d|zlog/i.test(name)
                         && st.mtimeMs >= cutoff;
        const isConfig = /^(wiz3D|HD3D|3DVision)_Config\.xml$/i.test(name);
        if (isLog || isConfig) out.push(full);
    }
    return out;
}

function line(label, value) { return value ? `- **${label}:** ${value}\n` : ''; }

/**
 * ctx: { kind: 'game'|'app', outcome, notes, appVersion,
 *        game: {id,title,exe}, fix: {id,name,type}, record (install record),
 *        display, output, includeLogs }
 * Returns { zipPath, folder, issueUrl, title }.
 */
async function createReport(ctx) {
    const kind = ctx.kind === 'app' ? 'app' : 'game';
    const sys  = await systemInfo(ctx.appVersion);
    const rec  = ctx.record || {};
    const outcome = OUTCOMES[ctx.outcome] || '';

    const title = kind === 'game'
        ? `[Game report] ${ctx.game?.title || 'Unknown game'}: ${outcome || 'report'}`
        : `[Stereopticon] ${String(ctx.notes || 'Problem report').split('\n')[0].slice(0, 80)}`;

    let body = '';
    if (kind === 'game') {
        body += `### Game\n`;
        body += line('Game', ctx.game?.title);
        body += line('Executable', ctx.game?.exe);
        body += line('Result', outcome);
        body += `\n### wiz3D\n`;
        body += line('Version', rec.wiz3dVersion);
        body += line('Render path', rec.wiz3dVariant);
        body += line('Chosen path', rec.wiz3dPath ? `${rec.wiz3dPath} (overridden on the game page)` : 'recommended');
        body += line('Catalogue fix', ctx.fix ? `${ctx.fix.name} (${ctx.fix.type})` : '');
        body += line('Display', ctx.display);
        body += line('Output', ctx.output);
    }
    body += `\n### What happened\n${(ctx.notes || '').trim() || '_No notes._'}\n`;
    body += `\n### System\n`;
    body += line('Stereopticon', sys.stereopticon);
    body += line('Windows', sys.windows);
    body += line('GPU', sys.gpu);
    body += line('CPU', sys.cpu);
    body += line('Memory', sys.memory);

    // Write the folder and zip.
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const slug   = String(ctx.game?.id || kind).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    const folder = path.join(REPORT_DIR, `${stamp()}-${slug}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'report.md'), `# ${title}\n\n${body}`);
    fs.writeFileSync(path.join(folder, 'details.json'), JSON.stringify({ ...ctx, system: sys }, null, 2));

    const zip = new AdmZip();
    zip.addLocalFile(path.join(folder, 'report.md'));
    zip.addLocalFile(path.join(folder, 'details.json'));
    const included = [];
    if (ctx.includeLogs !== false) {
        for (const f of logger.recentLogFiles(2)) {
            zip.addFile(`stereopticon-logs/${path.basename(f)}`, tail(f));
            included.push(path.basename(f));
        }
        for (const f of gameFiles(rec.installDir)) {
            zip.addFile(`game/${path.basename(f)}`, tail(f));
            included.push(path.basename(f));
        }
    }
    const zipPath = `${folder}.zip`;
    zip.writeZip(zipPath);

    body += `\n### Attachments\nThe report zip \`${path.basename(zipPath)}\` holds: ${included.length ? included.join(', ') : 'the report only'}.\n` +
            `_Drag it into this issue before submitting._\n`;

    let urlBody = body;
    if (urlBody.length > URL_BODY_LIMIT) urlBody = urlBody.slice(0, URL_BODY_LIMIT) + '\n\n_(cut short; the full report is in the zip)_';
    const issueUrl = kind === 'game'
        ? siteReportUrl(ctx, rec, sys, path.basename(zipPath))
        : `https://github.com/${REPOS.app}/issues/new?title=${encodeURIComponent(title)}` +
          `&body=${encodeURIComponent(urlBody)}&labels=bug`;

    logger.info('report', `Report created: ${zipPath}`);
    return { zipPath, folder, issueUrl, title, included };
}

module.exports = { createReport, OUTCOMES, REPORT_DIR };
