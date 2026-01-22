// This script handles logging for the application

// Imports
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define log file path
const logFilePath = path.join(__dirname, 'app.log');

// Logging function
function logMessage(message, level = 'info', loglevel = 'info') {
    // Logs so that most recent logs are at the top
    if (["debug", "info", "warn", "error"].indexOf(level) < ["debug", "info", "warn", "error"].indexOf(loglevel)) {
        return; // Skip logging if level is lower than current loglevel
    }

    // Prepare new log entry
    const now = new Date();
    const timestamp = now.toLocaleDateString('en-US', { 
        day: '2-digit', 
        month: '2-digit', 
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    });
    const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

    let existingLogs = '';
    try {
        existingLogs = fs.readFileSync(logFilePath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err; // Only ignore file-not-found
    }

    // Only keep the latest 1000 lines
    const existingLogLines = existingLogs ? existingLogs.split('\n') : [];
    if (existingLogLines.length >= 1000) {
        existingLogLines.splice(1000 - 1); // Keep only the first 999 lines
        existingLogs = existingLogLines.join('\n');
    }

    // Prepend new log entry to existing logs
    const newLogContent = logEntry + (existingLogs ? '\n' + existingLogs : '');
    fs.writeFileSync(logFilePath, newLogContent, 'utf8');
}

// Exports
export { logMessage };