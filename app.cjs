// Hostinger Passenger/LiteSpeed Entry Point (CommonJS)
// This file is CommonJS so Hostinger's Passenger can require() it without ERR_REQUIRE_ESM.
// It then dynamically imports the actual ESM server.

const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'startup-debug.log');
function log(msg) {
    try { fs.appendFileSync(logFile, `[CJS BOOT] ${msg}\n`); } catch(e) {}
}

log("Starting app.cjs...");

async function boot() {
    try {
        log("Dynamically importing server/server.js...");
        await import('./server/server.js');
        log("Import successful!");
    } catch (err) {
        log("FATAL ERROR LOADING APP: " + err.message);
        if (err.stack) {
            log(err.stack);
        }
        console.error("FATAL ERROR LOADING APP:", err);
    }
}

boot();
