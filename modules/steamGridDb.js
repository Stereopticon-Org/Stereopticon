'use strict';
/**
 * modules/steamGridDb.js
 *
 * Artwork from SteamGridDB (www.steamgriddb.com), for the game details
 * dialog. The API needs a free personal key (SteamGridDB → Preferences →
 * API), entered in Settings → General → Artwork and kept in settings.json.
 * Builds made by GitHub Actions can also carry Stereopticon's own key
 * (the SGDB_API_KEY secret, written to modules/builtin-keys.json at build
 * time and never committed); the user's key, when set, is used instead.
 *
 *   search(term)          games matching a name: [{ id, name, year }]
 *   artwork(gameId)       { posters, heroes } for a SteamGridDB game id
 */

const https = require('https');
const appSettings = require('./appSettings');

const API = 'https://www.steamgriddb.com/api/v2';

function builtinKey() {
    try { return String(require('./builtin-keys.json').steamGridDb || '').trim(); } catch { return ''; }
}
function apiKey() {
    return String(appSettings.get('steamGridDbKey') || '').trim() || builtinKey();
}
function isAvailable() { return !!apiKey(); }

function get(pathAndQuery) {
    const key = apiKey();
    if (!key) return Promise.reject(new Error('Add your SteamGridDB API key in Settings → General → Artwork first.'));
    return new Promise((resolve, reject) => {
        const req = https.get(API + pathAndQuery, {
            headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'Stereopticon', Accept: 'application/json' },
        }, res => {
            let body = ''; res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => {
                if (res.statusCode === 401 || res.statusCode === 403) { reject(new Error('SteamGridDB did not accept the API key.')); return; }
                if (res.statusCode !== 200) { reject(new Error(`SteamGridDB returned HTTP ${res.statusCode}`)); return; }
                try {
                    const j = JSON.parse(body);
                    if (j.success === false) reject(new Error((j.errors || []).join(', ') || 'SteamGridDB error'));
                    else resolve(j.data);
                } catch (e) { reject(e); }
            });
        });
        req.setTimeout(15000, () => req.destroy(new Error('Timed out reaching SteamGridDB')));
        req.on('error', reject);
    });
}

async function search(term) {
    const data = await get(`/search/autocomplete/${encodeURIComponent(term)}`);
    return (data || []).slice(0, 12).map(g => ({
        id: g.id, name: g.name,
        year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null,
    }));
}

const pick = list => (list || []).filter(a => !a.nsfw && !a.humor).slice(0, 24)
    .map(a => ({ id: a.id, url: a.url, thumb: a.thumb || a.url, width: a.width, height: a.height, style: a.style }));

/** Portrait posters (the library tiles) and wide heroes (the game page banner). */
async function artwork(gameId) {
    const [posters, heroes] = await Promise.all([
        get(`/grids/game/${gameId}?dimensions=600x900,342x482,660x930`).catch(() => []),
        get(`/heroes/game/${gameId}`).catch(() => []),
    ]);
    return { posters: pick(posters), heroes: pick(heroes) };
}

module.exports = { search, artwork, isAvailable, hasBuiltinKey: () => !!builtinKey() };
