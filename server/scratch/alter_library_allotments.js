import db from '../config/db.js';

async function run() {
    try {
        await db.query('DROP TABLE IF EXISTS library_allotments');
        const query = `
            CREATE TABLE library_allotments (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT UNSIGNED NOT NULL,
                department_id INT UNSIGNED NOT NULL,
                class_ids VARCHAR(500) NOT NULL,
                days VARCHAR(255) NOT NULL,
                start_time TIME NULL,
                end_time TIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
            )
        `;
        await db.query(query);
        console.log('Table recreated successfully with class_ids and days.');
    } catch(err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
run();
