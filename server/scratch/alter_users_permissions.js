import db from '../config/db.js';

async function alterUsers() {
    try {
        await db.query(`ALTER TABLE users ADD COLUMN permissions JSON DEFAULT NULL`);
        console.log('Added permissions column to users table');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('permissions column already exists');
        } else {
            console.error('Error altering table:', err);
        }
    } finally {
        process.exit();
    }
}
alterUsers();
