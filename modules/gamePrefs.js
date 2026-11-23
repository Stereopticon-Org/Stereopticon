'use strict';
/**
 * modules/gamePrefs.js
 *
 * Per-game choices that override the global ones, stored at
 * ~/.stereopticon/game-prefs.json as { [gameId]: { ... } }:
 *
 *   wiz3dVersion   release tag to use for this game instead of the current one
 *   wiz3dPath      render path key (see WIZ3D_PATHS) instead of the catalogue's
 */

const fs   = require('fs');
const path = require('path');
const { BASE } = require('./appSettings');

const FILE = path.join(BASE, 'game-prefs.json');

// Render paths a user can pick for a game. `type` is the wiz3D fix type the
// installer understands; `api` overrides the catalogue's graphics API.
const WIZ3D_PATHS = {
    'injector-dx7':  { label: 'Stereo Injector (DX7)',          type: 'wiz3d_wrapper',     api: 'DX7'  },
    'injector-dx8':  { label: 'Stereo Injector (DX8)',          type: 'wiz3d_wrapper',     api: 'DX8'  },
    'injector-dx9':  { label: 'Stereo Injector (DX9)',          type: 'wiz3d_wrapper',     api: 'DX9'  },
    'injector-dx11': { label: 'Stereo Injector (DX10/11)',      type: 'wiz3d_wrapper',     api: 'DX11' },
    'hd3d':          { label: 'AMD HD3D',                       type: 'wiz3d_hd3d',        api: null   },
    '3dv-dx9':       { label: '3D Vision Direct (DX9)',         type: 'wiz3d_3dvision_dm', api: 'DX9'  },
    '3dv-dx10':      { label: '3D Vision Direct (DX10)',        type: 'wiz3d_3dvision_dm', api: 'DX10' },
    '3dv-dx11':      { label: '3D Vision Direct (DX11)',        type: 'wiz3d_3dvision_dm', api: 'DX11' },
    'opengl':        { label: 'OpenGL Quad-Buffer Stereo',      type: 'wiz3d_opengl',      api: 'OpenGL' },
};

function readAll() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
    catch { return {}; }
}

function get(gameId) {
    return (gameId && readAll()[gameId]) || {};
}

/** Merge values into a game's prefs; null or '' removes a key. */
function set(gameId, values) {
    if (!gameId) return {};
    const all = readAll();
    const next = { ...(all[gameId] || {}) };
    for (const [k, v] of Object.entries(values || {})) {
        if (v === null || v === undefined || v === '') delete next[k];
        else next[k] = v;
    }
    if (next.wiz3dPath && !WIZ3D_PATHS[next.wiz3dPath]) delete next.wiz3dPath;
    if (Object.keys(next).length) all[gameId] = next; else delete all[gameId];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
    return next;
}

/** Release tags some game is pinned to, so they are never pruned. */
function pinnedWiz3DVersions() {
    return [...new Set(Object.values(readAll()).map(p => p.wiz3dVersion).filter(Boolean))];
}

/** The fix as the installer should see it with a path override applied. */
function applyWiz3DPath(profile, pathKey) {
    const p = pathKey && WIZ3D_PATHS[pathKey];
    if (!p || !profile) return profile;
    return { ...profile, type: p.type, wiz3d_api_raw: p.api || profile.wiz3d_api_raw };
}

module.exports = { get, set, readAll, pinnedWiz3DVersions, applyWiz3DPath, WIZ3D_PATHS };
