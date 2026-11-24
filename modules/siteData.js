'use strict';
/**
 * modules/siteData.js
 *
 * Live data from stereopticon.org, which the site rebuilds from approved
 * game reports and project releases:
 *
 *   https://stereopticon.org/data/games.json   { games: [{ name, slug, api, source, status, install, notes }] }
 *   https://stereopticon.org/data/news.json    { items: [{ kind, title, date, project, summary, url }] }
 *
 * Each is cached in ~/.stereopticon/cache/ and refreshed every few hours, so
 * the app still shows the last known statuses when offline.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { BASE } = require('./appSettings');

const SITE      = 'https://stereopticon.org';
const CACHE_DIR = path.join(BASE, 'cache');
const TTL_MS    = 3 * 60 * 60 * 1000;

function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Stereopticon', Accept: 'application/json' } }, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        });
        req.setTimeout(15000, () => req.destroy(new Error('Timed out reaching stereopticon.org')));
        req.on('error', reject);
    });
}

async function cached(name, url, { fresh = false } = {}) {
    const file = path.join(CACHE_DIR, `site-${name}.json`);
    let stale = null;
    try {
        const st = fs.statSync(file);
        stale = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!fresh && Date.now() - st.mtimeMs < TTL_MS) return { data: stale, cached: true };
    } catch { /* no cache yet */ }
    try {
        const data = await getJson(url);
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
        return { data, cached: false };
    } catch (e) {
        if (stale) return { data: stale, cached: true, error: e.message };
        throw e;
    }
}

const games = opts => cached('games', `${SITE}/data/games.json`, opts);
const news  = opts => cached('news',  `${SITE}/data/news.json`,  opts);

module.exports = { games, news, SITE };
