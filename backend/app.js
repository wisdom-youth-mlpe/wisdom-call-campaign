
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const { authenticateToken, generateToken } = require('./auth');

const app = express();
// Using port 5001 to avoid conflicts
const port = 5001;

// Configure CORS to allow requests from frontend
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'https://calls.wisdommlpe.site'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// --- Google Sheets Setup ---
// User must provide valid credentials in .env or service-account.json
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_AUTH_EMAIL = process.env.GOOGLE_AUTH_EMAIL;
// Data tab name; columns: A=Zone, B=Unit, C=Name, D=Mobile, E=Call status, F=Call response, G=Mentor
const SHEET_TAB = process.env.SHEET_TAB || 'ExecutiveList';

// Robust parsing for the private key
const getPrivateKey = () => {
    let key = process.env.GOOGLE_AUTH_PRIVATE_KEY;
    if (!key) {
        console.error("FATAL: GOOGLE_AUTH_PRIVATE_KEY is missing from .env");
        return null;
    }

    // CASE 1: Key has literal \n characters (common if copied from JSON to .env)
    // Convert literal \n to actual newlines
    key = key.replace(/\\n/g, '\n');

    // CASE 2: Key is wrapped in quotes in the .env value itself
    if (key.startsWith('"') && key.endsWith('"')) {
        key = key.substring(1, key.length - 1);
    }

    // CASE 3: Check for header presence
    if (!key.includes('BEGIN PRIVATE KEY')) {
        console.error("FATAL: Private key seems invalid. It does not contain 'BEGIN PRIVATE KEY'");
        // Try to fix common copy-paste issue where header is missing?
    }

    console.log("Processed Private Key first 30 chars: ", key.substring(0, 30));
    console.log("Processed Private Key length: ", key.length);

    return key;
};

const GOOGLE_AUTH_KEY = getPrivateKey();

// Authentication using a service account credentials
const auth = new google.auth.GoogleAuth({
  credentials: {
      client_email: GOOGLE_AUTH_EMAIL,
      private_key: GOOGLE_AUTH_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Row shape helper for the data tab (A2:G)
const rowToMember = (row) => ({
    zone: (row[0] || '').trim(),
    unit: (row[1] || '').trim(),
    name: (row[2] || '').trim(),
    mobile: (row[3] || '').trim(),
    callStatus: (row[4] || '').trim(),
    callRemarks: (row[5] || '').trim(),
    mentor: (row[6] || '').trim()
});

// Mentors (sheet admins) only see rows assigned to them; the env master admin sees all
const visibleToUser = (member, user) =>
    user.role === 'super-admin' || member.mentor === user.username;

const fetchMembers = async () => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TAB}!A2:G`,
    });
    return (response.data.values || []).map(rowToMember);
};

// --- Routes ---

// 1. POST /api/call-status - Update Call status (Col E) and Call response (Col F) (Protected)
app.post('/api/call-status', authenticateToken, async (req, res) => {
    console.log("Received call status update request", req.body);
    const { zone, unit, name, callStatus, remarks } = req.body;

    try {
        // 1. Fetch A:G to find the row (and its mentor)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!A2:G`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No data found in sheet' });
        }

        // 2. Find row index by zone + unit + name
        const norm = (v) => (v || '').trim().toLowerCase();
        const rowIndex = rows.findIndex(row =>
            norm(row[0]) === norm(zone) &&
            norm(row[1]) === norm(unit) &&
            norm(row[2]) === norm(name)
        );

        if (rowIndex === -1) {
            console.error(`Person not found: ${zone} / ${unit} - ${name}`);
            return res.status(404).json({ status: 'error', message: 'Person not found in the list' });
        }

        // 3. Mentors may only update their own assignments
        const rowMentor = (rows[rowIndex][6] || '').trim();
        if (req.user.role !== 'super-admin' && rowMentor !== req.user.username) {
            return res.status(403).json({ status: 'error', message: 'Not assigned to you' });
        }

        const exactRowNumber = rowIndex + 2;
        console.log(`Found person at row ${exactRowNumber}`);

        // 4. Update columns E (Call status) and F (Call response)
        const updateRange = `${SHEET_TAB}!E${exactRowNumber}:F${exactRowNumber}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[callStatus, remarks]]
            },
        });

        console.log("Successfully updated call status");
        res.json({ status: 'success', message: 'Call status updated successfully' });
    } catch (error) {
        console.error('Error updating call status:', error);
        res.status(500).send('Error updating call status: ' + error.message);
    }
});

// 2. GET /api/config - Read saved WhatsApp message (S1) and image URL (T1)
app.get('/api/config', authenticateToken, async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!S1:U1`,
        });
        const row = (response.data.values || [[]])[0] || [];
        res.json({
            message: row[0] || '',
            imageUrl: row[1] || ''
        });
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

// 3. POST /api/config/message - Save WhatsApp message to S1
app.post('/api/config/message', authenticateToken, async (req, res) => {
    const { message } = req.body;
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!S1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[message]] },
        });
        console.log('WhatsApp message saved to S1');
        res.json({ success: true, message: 'Message saved successfully' });
    } catch (error) {
        console.error('Error saving message:', error);
        res.status(500).json({ error: 'Failed to save message' });
    }
});

// --- Authentication & Dashboard Routes ---
// Admin credentials from .env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// 4. POST /api/auth/login - Admin / mentor login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Check Master Admin (from .env)
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const token = generateToken({ username, role: 'super-admin' });
            return res.json({
                success: true,
                token,
                user: { username, role: 'super-admin' }
            });
        }

        // 2. Check Sheet Admins (mentors)
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'admin!A2:B',
            });

            const rows = response.data.values || [];

            // Find matching user
            const adminUser = rows.find(row => {
                const sheetUsername = (row[0] || '').trim();
                const sheetPassword = (row[1] || '').trim(); // Plain text as requested
                return sheetUsername === username && sheetPassword === password;
            });

            if (adminUser) {
                const token = generateToken({ username: (adminUser[0] || '').trim(), role: 'admin' });
                return res.json({
                    success: true,
                    token,
                    user: { username: (adminUser[0] || '').trim(), role: 'admin' }
                });
            }

        } catch (sheetError) {
            console.error('Error fetching admin sheet:', sheetError);
            // Don't fail the whole request, just log it.
            // If master admin failed and sheet fetch failed, we return invalid credentials below.
        }

        res.status(401).json({ success: false, error: 'Invalid credentials' });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// 5. GET /api/dashboard/zones - Zones with units and call progress (Protected, mentor-scoped)
app.get('/api/dashboard/zones', authenticateToken, async (req, res) => {
    try {
        const members = (await fetchMembers()).filter(m => visibleToUser(m, req.user));

        const zoneMap = {};
        members.forEach(m => {
            if (!m.zone) return;

            if (!zoneMap[m.zone]) {
                zoneMap[m.zone] = { name: m.zone, units: [], total: 0, called: 0 };
            }

            zoneMap[m.zone].total++;
            if (m.callStatus) zoneMap[m.zone].called++;
            if (m.unit && !zoneMap[m.zone].units.includes(m.unit)) {
                zoneMap[m.zone].units.push(m.unit);
            }
        });

        const zones = Object.values(zoneMap).map(z => ({ ...z, units: z.units.sort() }));
        res.json({ zones });
    } catch (error) {
        console.error('Error fetching zones:', error);
        res.status(500).json({ error: 'Failed to fetch zone data' });
    }
});

// 6. GET /api/dashboard/members - Member list with filtering (Protected, mentor-scoped)
app.get('/api/dashboard/members', authenticateToken, async (req, res) => {
    try {
        const { zone, unit } = req.query;

        let members = (await fetchMembers()).filter(m => visibleToUser(m, req.user));

        // Filter by zone if specified
        if (zone && zone !== 'all') {
            members = members.filter(m => m.zone.toLowerCase() === zone.toLowerCase());
        }

        // Filter by unit if specified
        if (unit && unit !== 'all') {
            members = members.filter(m => m.unit.toLowerCase() === unit.toLowerCase());
        }

        res.json({ members });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// 7. GET /api/report - Call-completion report (Protected, mentor-scoped)
app.get('/api/report', authenticateToken, async (req, res) => {
    try {
        const members = (await fetchMembers()).filter(m => visibleToUser(m, req.user));

        const pct = (called, total) => total > 0 ? parseFloat(((called / total) * 100).toFixed(1)) : 0;

        const total = members.length;
        const called = members.filter(m => m.callStatus).length;

        const groupStats = (keyFn) => {
            const map = {};
            members.forEach(m => {
                const key = keyFn(m);
                if (!key) return;
                if (!map[key]) map[key] = { total: 0, called: 0 };
                map[key].total++;
                if (m.callStatus) map[key].called++;
            });
            return map;
        };

        const byZone = Object.entries(groupStats(m => m.zone))
            .map(([zone, s]) => ({ zone, total: s.total, called: s.called, percent: pct(s.called, s.total) }))
            .sort((a, b) => a.zone.localeCompare(b.zone));

        const result = {
            overall: { total, called, remaining: total - called, percent: pct(called, total) },
            byZone,
            pending: members
                .filter(m => !m.callStatus)
                .map(({ zone, unit, name, mobile, mentor }) => ({ zone, unit, name, mobile, mentor }))
        };

        // Per-mentor breakdown only for the master admin
        if (req.user.role === 'super-admin') {
            result.byMentor = Object.entries(groupStats(m => m.mentor))
                .map(([mentor, s]) => ({ mentor, total: s.total, called: s.called, percent: pct(s.called, s.total) }))
                .sort((a, b) => a.mentor.localeCompare(b.mentor));
        }

        res.json(result);
    } catch (error) {
        console.error('Error building report:', error);
        res.status(500).json({ error: 'Failed to build report' });
    }
});

app.listen(port, () => {
    console.log(`Backend server strictly running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
});
