import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

async function setupLibraryAllotments() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'timetable_project'
    });

    try {
        console.log('Connected to database. Creating library_allotments table...');

        const query = `
            CREATE TABLE IF NOT EXISTS library_allotments (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT UNSIGNED NOT NULL,
                department_id INT UNSIGNED NOT NULL,
                class_id INT UNSIGNED NOT NULL,
                allotment_date DATE NOT NULL,
                start_time TIME NULL,
                end_time TIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
            )
        `;

        await connection.query(query);
        console.log('library_allotments table created successfully.');
    } catch (error) {
        console.error('Error creating library_allotments table:', error);
    } finally {
        await connection.end();
    }
}

setupLibraryAllotments();
