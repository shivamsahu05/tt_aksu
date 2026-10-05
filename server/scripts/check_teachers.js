import db from '../config/db.js';

async function check() {
    try {
        const [rows] = await db.query('DESCRIBE teachers');
        console.log(rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
