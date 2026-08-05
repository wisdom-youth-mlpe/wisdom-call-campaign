
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

// --- Routes ---

// 1. POST /api/call-status - Update Call Status (Col I) and Remarks (Col J) (Protected)
app.post('/api/call-status', authenticateToken, async (req, res) => {
    console.log("Received call status update request", req.body);
    const { zone, name, callStatus, remarks } = req.body;

    try {
        // 1. Fetch range A:B to find row
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ExecutiveList!A2:B',
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No data found in sheet' });
        }

        // 2. Find row index
        const rowIndex = rows.findIndex(row => {
            const rowZone = (row[0] || '').trim().toLowerCase();
            const rowName = (row[1] || '').trim().toLowerCase();
            return rowZone === zone.trim().toLowerCase() && rowName === name.trim().toLowerCase();
        });

        if (rowIndex === -1) {
            console.error(`User not found: ${zone} - ${name}`);
            return res.status(404).json({ status: 'error', message: 'User not found in the list' });
        }

        const exactRowNumber = rowIndex + 2;
        console.log(`Found user at row ${exactRowNumber}`);

        // 3. Update columns I (Call Status) and J (Remarks)
        const updateRange = `ExecutiveList!I${exactRowNumber}:J${exactRowNumber}`;

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
            range: 'ExecutiveList!S1:U1',
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
            range: 'ExecutiveList!S1',
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

// 4. POST /api/auth/login - Admin login
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

        // 2. Check Sheet Admins
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
                const token = generateToken({ username, role: 'admin' });
                return res.json({
                    success: true,
                    token,
                    user: { username, role: 'admin' }
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

// 5. GET /api/dashboard/zones - Zone-wise statistics (Protected)
app.get('/api/dashboard/zones', authenticateToken, async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ExecutiveList!A2:E',
        });

        const rows = response.data.values || [];

        // Group by zone, excluding rows with "Leave" status
        const zoneMap = {};
        rows.forEach(row => {
            const zone = (row[0] || '').trim();
            const status = (row[4] || '').trim();

            if (!zone) return;
            // Skip rows where status is "Leave"
            if (status === 'Leave') return;

            if (!zoneMap[zone]) {
                zoneMap[zone] = { name: zone, total: 0, registered: 0, notRegistered: 0 };
            }

            zoneMap[zone].total++;
            if (status === 'Success') {
                zoneMap[zone].registered++;
            } else {
                zoneMap[zone].notRegistered++;
            }
        });

        const zones = Object.values(zoneMap);
        res.json({ zones });
    } catch (error) {
        console.error('Error fetching zones:', error);
        res.status(500).json({ error: 'Failed to fetch zone data' });
    }
});

// 6. GET /api/dashboard/members - Get member list with filtering (Protected)
app.get('/api/dashboard/members', authenticateToken, async (req, res) => {
    try {
        const { zone, status, role } = req.query;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ExecutiveList!A2:K',
        });

        let rows = response.data.values || [];

        // Transform to member objects, excluding those with "Leave" status
        let members = rows
            .filter(row => (row[4] || '').trim() !== 'Leave')
            .map(row => {
                const mobileC = (row[2] || '').trim();
                const mobileH = (row[7] || '').trim();
                // Use column H if column C is empty
                const mobile = mobileC || mobileH;

                return {
                    zone: (row[0] || '').trim(),
                    name: (row[1] || '').trim(),
                    mobile: mobile,
                    participated: (row[3] || '').trim(),
                    status: (row[4] || '').trim(),
                    role: (row[5] || '').trim(),
                    executive: (row[6] || '').trim(),
                    registered: (row[4] || '').trim() === 'Success',
                    callStatus: (row[8] || '').trim(),
                    callRemarks: (row[9] || '').trim(),
                    checkedIn: (row[10] || '').trim() === 'Present'
                };
            });

        // Filter by zone if specified
        if (zone && zone !== 'all') {
            members = members.filter(m => m.zone.toLowerCase() === zone.toLowerCase());
        }

        // Filter by role if specified
        if (role && role !== 'All') {
            if (role === 'Secretariat') {
                members = members.filter(m => m.role === role);
            } else if (role === 'Executive') {
                members = members.filter(m => m.executive === role);
            }
        }

        // Filter by status if specified
        if (status === 'registered') {
            members = members.filter(m => m.registered);
        } else if (status === 'not_registered') {
            members = members.filter(m => !m.registered);
        }

        res.json({ members });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

app.listen(port, () => {
    console.log(`Backend server strictly running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
});
