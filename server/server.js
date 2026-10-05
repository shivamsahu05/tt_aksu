/**
 * server/server.js — Hostinger Entry Point
 * Configured in Hostinger panel: Entry file = server/server.js
 *
 * ONLY uses Node.js built-in modules in static imports (always work).
 * Dynamically imports _server.js (full Express app).
 * If _server.js fails, starts a FALLBACK HTTP server showing the actual error
 * so we can read it in the browser instead of just getting a 503.
 */

// ── Builtin-only static imports ───────────────────────────────────────────────
import { appendFileSync, existsSync, unlinkSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

// ── Setup ─────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const LOG_FILE   = join(__dirname, '..', 'startup-debug.log');

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { appendFileSync(LOG_FILE, line); } catch (_) {}
    process.stdout.write(line);
}

// ── Early diagnostics (runs before any npm package is touched) ────────────────
log('=== HOSTINGER SERVER ENTRY POINT ===');
log(`Node.js   : ${process.version}`);
log(`NODE_ENV  : ${process.env.NODE_ENV}`);
log(`PORT      : ${process.env.PORT}`);
log(`DB_HOST   : ${process.env.DB_HOST}`);
log(`DB_NAME   : ${process.env.DB_NAME}`);
log(`CWD       : ${process.cwd()}`);
log(`__dirname : ${__dirname}`);

const serverFile = join(__dirname, '_server.js');
log(`_server.js: ${existsSync(serverFile) ? 'EXISTS ✅' : 'MISSING ❌'}`);

const PORT = process.env.PORT || 3000;
log(`Using PORT: ${PORT}`);

// ── Load the full Express app ─────────────────────────────────────────────────
log('Loading _server.js ...');

try {
    await import('./_server.js');
    log('_server.js loaded successfully ✅');
} catch (err) {
    // ── Fallback: show real error in browser instead of just 503 ─────────────
    log(`❌ FATAL ERROR loading _server.js:`);
    log(`   Message : ${err.message}`);
    log(`   Code    : ${err.code || 'N/A'}`);
    if (err.stack) {
        err.stack.split('\n').forEach(line => log(`   ${line}`));
    }

    const errorBody = [
        'SERVER STARTUP FAILED',
        '======================',
        '',
        `Error   : ${err.message}`,
        `Code    : ${err.code || 'N/A'}`,
        '',
        'Stack Trace:',
        err.stack || '(none)',
        '',
        'Environment:',
        `  NODE_ENV = ${process.env.NODE_ENV}`,
        `  PORT     = ${process.env.PORT}`,
        `  DB_HOST  = ${process.env.DB_HOST}`,
        `  DB_NAME  = ${process.env.DB_NAME}`,
        `  Node.js  = ${process.version}`,
        `  CWD      = ${process.cwd()}`,
        `  __dir    = ${__dirname}`,
    ].join('\n');

    // Start fallback server so Hostinger proxy shows error instead of 503
    const fallback = http.createServer((req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(errorBody);
    });

    fallback.listen(PORT, () => {
        log(`Fallback error server listening on ${PORT}`);
    });
}
