'use strict';
/**
 * scripts/import-native-3d.js
 *
 * Adds a "native 3D" entry to every game with its own 3D mode, from
 * PCGamingWiki's list of games with native 3D (Glossary:Native 3D) and each
 * game's "native 3d notes".
 *
 *   node scripts/import-native-3d.js        then  npm run bundle
 *
 * Only facts are stored: which 3D formats a game outputs, how 3D is switched
 * on (in-game setting, config file, launch option), whether it needs a
 * particular display's software, and a link to the game's PCGamingWiki page,
 * where the full instructions are. PCGamingWiki's text itself is not copied
 * (it is CC BY-NC-SA). Credited in Notice.md.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ROOT  = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'data', 'games');
const API   = 'https://www.pcgamingwiki.com/w/api.php';

function get(params) {
    const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Stereopticon catalogue importer (stereopticon.org)' } }, res => {
            let body = ''; res.setEncoding('utf8');
            res.on('data', d => { body += d; });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`Not JSON from ${url}: ${body.slice(0, 120)}`)); } });
        }).on('error', reject);
    });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const slugOf = s => String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const fileSlug = s => String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// What a game's notes say about its 3D, in our own terms.
function describe(notes) {
    const n = String(notes || '');
    const formats = [];
    const add = (re, f) => { if (re.test(n) && !formats.includes(f)) formats.push(f); };
    add(/side[- ]by[- ]side|\bSBS\b/i, 'sbs');
    add(/top[- ]and[- ]bottom|over[- ]under|\bTAB\b/i, 'tab');
    add(/interleav|interlac|row[- ]by[- ]row/i, 'interlaced');
    add(/checkerboard/i, 'checkerboard');
    add(/anaglyph|red[/ -]cyan/i, 'anaglyph');
    add(/frame[- ]packing|HDMI 1\.4/i, 'frame_packing');
    add(/frame[- ]sequential|shutter/i, 'frame_sequential');
    add(/HD3D/i, 'hd3d');
    add(/3D Vision/i, '3dvision');
    add(/quad[- ]?buffer/i, 'quadbuffer');
    add(/Odyssey 3D|Simulated Reality|SpatialLabs|Leia|Dimenco|lightfield|light field/i, 'sr');

    const enable = /\.(cfg|ini|xml|json|txt)\b|\{\{file\||\{\{p\||config/i.test(n) ? 'config file'
                 : /launch option|command[- ]line|-[a-z]*stereo|-3d\b/i.test(n) ? 'launch option'
                 : 'in-game settings';
    const exclusive = /Odyssey 3D Hub exclusive/i.test(n) ? 'Samsung Odyssey 3D Hub'
                    : /SpatialLabs exclusive/i.test(n) ? 'Acer SpatialLabs' : null;
    const rendering = /depth reprojection/i.test(n) ? 'Depth Map Reprojection'
                    : /multi[- ]view|quilt/i.test(n) ? 'Multi-View Rendering'
                    : /sequential[- ]view/i.test(n) ? 'Sequential-View Rendering'
                    : 'Dual-View Rendering';
    const headtracking = /head[- ]tracking supported|head tracking/i.test(n);
    return { formats, enable, exclusive, rendering, headtracking };
}

// Our output ids for the formats a display can take straight from the game.
const FORMAT_OUTPUTS = { sbs: ['sbs', 'sbs_half'], tab: ['tab', 'tab_half'], interlaced: ['interlaced'],
                         anaglyph: ['anaglyph'], frame_packing: ['frame_packing'], frame_sequential: ['frame_sequential'],
                         checkerboard: ['interlaced'], sr: ['sr_weave'] };
const FORMAT_NAMES = { sbs: 'side-by-side', tab: 'top-and-bottom', interlaced: 'interleaved', checkerboard: 'checkerboard',
                       anaglyph: 'anaglyph', frame_packing: 'HDMI frame packing', frame_sequential: 'frame sequential (shutter glasses)',
                       hd3d: 'AMD HD3D', '3dvision': 'Nvidia 3D Vision', quadbuffer: 'OpenGL quad-buffer', sr: 'glasses-free 3D displays' };

function fixFor(game, d, pageTitle) {
    const list = d.formats.map(f => FORMAT_NAMES[f]).filter(Boolean);
    const outputs = [...new Set(d.formats.flatMap(f => FORMAT_OUTPUTS[f] || []))];
    // Games whose only 3D is the old AMD/Nvidia driver modes need wiz3D's
    // HD3D or 3D Vision Direct path instead; the native entry is not the first pick.
    // No format in the notes (they describe a config edit, say) usually means
    // plain side-by-side, so it still counts as directly usable.
    const direct = !d.formats.length || d.formats.some(f => FORMAT_OUTPUTS[f]);
    return {
        id: `${fileSlug(game.title).replace(/-/g, '_')}_native_3d`,
        name: 'Own 3D mode (built into the game)',
        type: 'native_3d',
        cost: 'free',
        authors: ['Built into the game'],
        recommended: direct && !d.exclusive,
        rendering_method: d.rendering,
        headtracking: d.headtracking ? 'native' : 'None',
        native_outputs: outputs,
        native_formats: d.formats,
        native_enable: d.enable,
        native_exclusive: d.exclusive,
        pipeline_overrides: {},
        url: `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
        source: 'PCGamingWiki (Glossary:Native 3D)',
        notes: `This game has its own 3D mode${list.length ? ` (${list.join(', ')})` : ''}, switched on in ${
            d.enable === 'config file' ? "a config file" : d.enable === 'launch option' ? 'a launch option' : "the game's settings"}.` +
            (d.exclusive ? ` It only works with ${d.exclusive}.` : '') +
            ' PCGamingWiki has the steps.',
    };
}

(async () => {
    // 1. The list.
    const page = await get({ action: 'parse', page: 'Glossary:Native 3D', prop: 'text' });
    const html = page.parse.text['*'];
    const a = html.indexOf('id="Games_with_Native_3D_support"');
    const b = html.indexOf('id="Games_modified_to_support_Native_3D"');
    const titles = [...html.slice(a, b).matchAll(/<th scope="row"><a href="[^"]+" title="([^"]+)"/g)].map(m => decode(m[1]));
    console.log(`PCGamingWiki lists ${titles.length} games with native 3D`);

    // 2. Each page's VR support fields and Steam id, 40 pages per request.
    const info = new Map();
    for (let i = 0; i < titles.length; i += 40) {
        const batch = titles.slice(i, i + 40);
        const r = await get({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
                              titles: batch.join('|'), formatversion: '2', redirects: '1' });
        const redirects = new Map((r.query.redirects || []).map(x => [x.to, x.from]));
        for (const p of r.query.pages || []) {
            const w = p.revisions?.[0]?.slots?.main?.content || '';
            info.set(redirects.get(p.title) || p.title, {
                pageTitle: p.title,
                steam: (/\|steam appid\s*=\s*([0-9]+)/i.exec(w) || [])[1] || '',
                notes: (/\|native 3d notes\s*=([^\n]*)/i.exec(w) || [])[1] || '',
            });
        }
        await wait(1500);
    }

    // 3. Into the catalogue.
    const files = fs.readdirSync(GAMES).filter(f => f.endsWith('.json'));
    const bySteam = new Map(), bySlug = new Map();
    for (const f of files) {
        const g = JSON.parse(fs.readFileSync(path.join(GAMES, f), 'utf8'));
        if (g.steam_app_id) bySteam.set(String(g.steam_app_id), f);
        if (!bySlug.has(slugOf(g.title))) bySlug.set(slugOf(g.title), f);
    }
    let added = 0, updated = 0, created = 0;
    for (const t of titles) {
        const i = info.get(t) || { pageTitle: t, steam: '', notes: '' };
        const d = describe(i.notes);
        let file = (i.steam && bySteam.get(i.steam)) || bySlug.get(slugOf(t));
        let game;
        if (file) game = JSON.parse(fs.readFileSync(path.join(GAMES, file), 'utf8'));
        else {
            file = `${fileSlug(t)}.json`;
            game = { id: fileSlug(t).replace(/-/g, '_'), title: t, developer: '', graphics_api: '', default_path: '',
                     exe_name: '', fixes: [], ...(i.steam ? { steam_app_id: i.steam } : {}) };
            created++;
        }
        if (!game.steam_app_id && i.steam) game.steam_app_id = i.steam;
        const fix = fixFor(game, d, i.pageTitle);
        const at = (game.fixes || []).findIndex(f => f.type === 'native_3d');
        if (at >= 0) { game.fixes[at] = fix; updated++; } else { (game.fixes = game.fixes || []).push(fix); added++; }
        fs.writeFileSync(path.join(GAMES, file), JSON.stringify(game, null, 2) + '\n');
    }
    console.log(`Native 3D entries: ${added} added, ${updated} updated; ${created} new games`);
})().catch(e => { console.error(e); process.exit(1); });
