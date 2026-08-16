
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
// Data tab name; columns: A=Zone, B=Unit, C=Name, D=Mobile, E=Call status, F=Call response,
// G=Mentor, H=Present (checkin), I=Peace Radio (checkin), J=Zameel (checkin)
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

// Mentors (sheet admins) only see rows assigned to them; the master admin and
// sheet-based viewers (super_admin tab) see everything
const visibleToUser = (member, user) =>
    user.role === 'super-admin' || user.role === 'viewer' || member.mentor === user.username;

// Event check-in access: the master admin, org-wide viewers (super_admin tab),
// and mentors who are dual-listed there (orgViewer flag). Regular mentors are
// still locked out — same blend as visibleToUser/seeAll elsewhere in the app.
const requireCheckinAccess = (req, res, next) => {
    const allowed = req.user.role === 'super-admin' || req.user.role === 'viewer' || !!req.user.orgViewer;
    if (!allowed) {
        return res.status(403).json({ error: 'Check-in access required' });
    }
    next();
};

// Call status values written to Col E, mirrored from the frontend's CALL_STATUS_OPTIONS
const CALL_STATUS_OPTIONS = [
    { value: '', label: 'Not Called Yet' },
    { value: 'vilichu_pankedukkum', label: 'വിളിച്ചു, പങ്കെടുക്കും' },
    { value: 'vilichu_pankedukkilla', label: 'വിളിച്ചു, പങ്കെടുക്കില്ല' },
    { value: 'phone_eduthilla_whatsapp', label: 'ഫോൺ എടുത്തില്ല, വാട്സാപ്പ് അയച്ചു' },
    { value: 'phone_eduthilla', label: 'ഫോൺ എടുത്തില്ല' },
    { value: 'call_pokunnilla', label: 'കോൾ പോകുന്നില്ല' },
    { value: 'mattullava', label: 'മറ്റുള്ളവ' }
];

// Only used by the call campaign (zones/members/report) — a row with no mentor
// was never assigned to be called, so it's excluded here. Check-in still sees
// everyone via fetchCheckinMembers below, which has no such filter.
const fetchMembers = async () => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TAB}!A2:G`,
    });
    return (response.data.values || []).map(rowToMember).filter(m => m.mentor);
};

// Event day check-in — reads the same data tab plus columns H/I/J (Present /
// Peace Radio / Zameel, each "Yes"/"No"). Separate from fetchMembers/rowToMember
// since this data is only ever shown on the super-admin-only check-in pages.
const fetchCheckinMembers = async () => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TAB}!A2:J`,
    });
    return (response.data.values || []).map(row => ({
        zone: (row[0] || '').trim(),
        unit: (row[1] || '').trim(),
        name: (row[2] || '').trim(),
        mobile: (row[3] || '').trim(),
        present: (row[7] || '').trim() === 'Yes',
        peaceRadio: (row[8] || '').trim() === 'Yes',
        zameel: (row[9] || '').trim() === 'Yes'
    }));
};

// admin tab: A=username, B=password, C=display name (optional)
const fetchAdminDirectory = async () => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'admin!A2:C',
    });
    return (response.data.values || []).map(row => ({
        username: (row[0] || '').trim(),
        password: (row[1] || '').trim(),
        name: (row[2] || '').trim()
    }));
};

// super_admin tab: A=Mobile Number, B=display name (optional). Logging in with this
// number (as both username and password, same convention as mentors) grants
// read-only visibility across every zone/unit/mentor — no call-status write access.
const fetchSuperAdminDirectory = async () => {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'super_admin!A2:B',
    });
    return (response.data.values || []).map(row => ({
        mobile: (row[0] || '').trim(),
        name: (row[1] || '').trim()
    }));
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

        // 3. Mentors may only update their own assignments; viewers are read-only
        const rowMentor = (rows[rowIndex][6] || '').trim();
        const canWrite = req.user.role === 'super-admin' || (req.user.role !== 'viewer' && rowMentor === req.user.username);
        if (!canWrite) {
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
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

// 4. POST /api/auth/login - Admin / mentor login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Check Master Admin (from .env)
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const name = ADMIN_NAME;
            const token = generateToken({ username, role: 'super-admin', name });
            return res.json({
                success: true,
                token,
                user: { username, role: 'super-admin', name }
            });
        }

        // 2. Check the mentor tab and the super_admin tab together — a number can be
        // in both (an active mentor who also gets org-wide report oversight)
        let mentorMatch = null;
        let orgViewerMatch = null;

        try {
            const directory = await fetchAdminDirectory();
            mentorMatch = directory.find(a => a.username === username && a.password === password) || null;
        } catch (sheetError) {
            console.error('Error fetching admin sheet:', sheetError);
        }

        try {
            const superAdmins = await fetchSuperAdminDirectory();
            orgViewerMatch = superAdmins.find(s => s.mobile === username && username === password) || null;
        } catch (superAdminError) {
            // The super_admin tab is optional — missing tab shouldn't break login for everyone else
            console.error('Error fetching super_admin sheet:', superAdminError);
        }

        if (mentorMatch) {
            // Mentor identity wins (keeps full calling/write access); orgViewer adds
            // the extra org-wide report view on top without changing their role
            const name = mentorMatch.name || orgViewerMatch?.name || mentorMatch.username;
            const orgViewer = !!orgViewerMatch;
            const token = generateToken({ username: mentorMatch.username, role: 'admin', name, orgViewer });
            return res.json({
                success: true,
                token,
                user: { username: mentorMatch.username, role: 'admin', name, orgViewer }
            });
        }

        if (orgViewerMatch) {
            // Read-only org-wide viewer, not also a mentor
            const name = orgViewerMatch.name || orgViewerMatch.mobile;
            const token = generateToken({ username: orgViewerMatch.mobile, role: 'viewer', name, orgViewer: true });
            return res.json({
                success: true,
                token,
                user: { username: orgViewerMatch.mobile, role: 'viewer', name, orgViewer: true }
            });
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
        const seeAll = req.user.role === 'super-admin' || req.user.role === 'viewer' ||
            (req.user.orgViewer && req.query.all === 'true');
        const members = (await fetchMembers()).filter(m => seeAll || m.mentor === req.user.username);

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

        const directory = await fetchAdminDirectory();
        const nameByUsername = Object.fromEntries(directory.map(a => [a.username, a.name]));
        members = members.map(m => ({ ...m, mentorName: nameByUsername[m.mentor] || '' }));

        res.json({ members });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// 7. GET /api/report - Call-completion report (Protected, mentor-scoped)
app.get('/api/report', authenticateToken, async (req, res) => {
    try {
        const { zone, unit, all } = req.query;
        // A mentor who is also listed in the super_admin tab (orgViewer) can request
        // the org-wide report with ?all=true, without losing their normal mentor scope elsewhere
        const seeAll = req.user.role === 'super-admin' || req.user.role === 'viewer' ||
            (req.user.orgViewer && all === 'true');
        let members = (await fetchMembers()).filter(m => seeAll || m.mentor === req.user.username);

        if (zone && zone !== 'all') {
            members = members.filter(m => m.zone.toLowerCase() === zone.toLowerCase());
        }
        if (unit && unit !== 'all') {
            members = members.filter(m => m.unit.toLowerCase() === unit.toLowerCase());
        }

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

        const directory = await fetchAdminDirectory();
        const nameByUsername = Object.fromEntries(directory.map(a => [a.username, a.name]));

        const byStatus = CALL_STATUS_OPTIONS.map(opt => ({
            value: opt.value,
            label: opt.label,
            count: members.filter(m => (m.callStatus || '') === opt.value).length
        }));

        const result = {
            overall: { total, called, remaining: total - called, percent: pct(called, total) },
            byStatus,
            byZone,
            pending: members
                .filter(m => !m.callStatus)
                .map(({ zone, unit, name, mobile, mentor }) => ({ zone, unit, name, mobile, mentor, mentorName: nameByUsername[mentor] || '' })),
            completed: members
                .filter(m => m.callStatus)
                .map(({ zone, unit, name, mobile, mentor, callStatus, callRemarks }) => ({ zone, unit, name, mobile, mentor, mentorName: nameByUsername[mentor] || '', callStatus, callRemarks }))
        };

        // Per-mentor breakdown whenever the org-wide view is active
        if (seeAll) {
            result.byMentor = Object.entries(groupStats(m => m.mentor))
                .map(([mentor, s]) => ({ mentor, mentorName: nameByUsername[mentor] || '', total: s.total, called: s.called, percent: pct(s.called, s.total) }))
                .sort((a, b) => (a.mentorName || a.mentor).localeCompare(b.mentorName || b.mentor));
        }

        res.json(result);
    } catch (error) {
        console.error('Error building report:', error);
        res.status(500).json({ error: 'Failed to build report' });
    }
});

// 8. GET /api/checkin/members - Event day check-in list with filtering (Protected, super-admin only)
app.get('/api/checkin/members', authenticateToken, requireCheckinAccess, async (req, res) => {
    try {
        const { zone, unit } = req.query;
        let members = await fetchCheckinMembers();

        if (zone && zone !== 'all') {
            members = members.filter(m => m.zone.toLowerCase() === zone.toLowerCase());
        }
        if (unit && unit !== 'all') {
            members = members.filter(m => m.unit.toLowerCase() === unit.toLowerCase());
        }

        res.json({ members });
    } catch (error) {
        console.error('Error fetching checkin members:', error);
        res.status(500).json({ error: 'Failed to fetch checkin members' });
    }
});

// 9. POST /api/checkin - Update Present (Col H), Peace Radio (Col I), Zameel (Col J) (Protected, super-admin only)
app.post('/api/checkin', authenticateToken, requireCheckinAccess, async (req, res) => {
    console.log("Received checkin update request", req.body);
    const { zone, unit, name, present, peaceRadio, zameel } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!A2:C`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No data found in sheet' });
        }

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

        const exactRowNumber = rowIndex + 2;
        const updateRange = `${SHEET_TAB}!H${exactRowNumber}:J${exactRowNumber}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[present ? 'Yes' : 'No', peaceRadio ? 'Yes' : 'No', zameel ? 'Yes' : 'No']]
            },
        });

        console.log(`Successfully updated checkin for row ${exactRowNumber}`);
        res.json({ status: 'success' });
    } catch (error) {
        console.error('Error updating checkin:', error);
        res.status(500).json({ status: 'error', message: 'Error updating checkin: ' + error.message });
    }
});

// 9b. POST /api/checkin/attendee - Add a new walk-in attendee, marked Present immediately (Protected, check-in access)
app.post('/api/checkin/attendee', authenticateToken, requireCheckinAccess, async (req, res) => {
    console.log("Received add-attendee request", req.body);
    const zone = (req.body.zone || '').trim();
    const unit = (req.body.unit || '').trim();
    const name = (req.body.name || '').trim();
    const mobile = (req.body.mobile || '').trim();

    if (!zone || !name || !mobile) {
        return res.status(400).json({ status: 'error', message: 'Zone, name, and mobile number are required' });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!A2:D`,
        });
        const rows = response.data.values || [];

        // Guard against accidentally adding someone already in the list
        const normMobile = mobile.replace(/\D/g, '');
        const existing = rows.find(row => (row[3] || '').replace(/\D/g, '') === normMobile && normMobile);
        if (existing) {
            return res.status(409).json({
                status: 'error',
                message: `A person with this mobile number already exists: ${existing[2] || 'Unknown'} (${existing[0] || ''}/${existing[1] || ''})`
            });
        }

        // A=Zone, B=Unit, C=Name, D=Mobile, E=CallStatus, F=CallResponse, G=Mentor, H=Present, I=PeaceRadio, J=Zameel
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB}!A:J`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[zone, unit, name, mobile, '', '', '', 'Yes', 'No', 'No']]
            },
        });

        console.log(`Added new attendee: ${name} (${zone}/${unit})`);
        res.json({ status: 'success' });
    } catch (error) {
        console.error('Error adding attendee:', error);
        res.status(500).json({ status: 'error', message: 'Error adding attendee: ' + error.message });
    }
});

// 10. GET /api/checkin/report - Event day check-in report (Protected, super-admin only)
app.get('/api/checkin/report', authenticateToken, requireCheckinAccess, async (req, res) => {
    try {
        const { zone, unit } = req.query;
        let members = await fetchCheckinMembers();

        if (zone && zone !== 'all') {
            members = members.filter(m => m.zone.toLowerCase() === zone.toLowerCase());
        }
        if (unit && unit !== 'all') {
            members = members.filter(m => m.unit.toLowerCase() === unit.toLowerCase());
        }

        const pct = (present, total) => total > 0 ? parseFloat(((present / total) * 100).toFixed(1)) : 0;

        const total = members.length;
        const present = members.filter(m => m.present).length;
        const peaceRadioCount = members.filter(m => m.peaceRadio).length;
        const zameelCount = members.filter(m => m.zameel).length;

        const byZoneMap = {};
        const byUnitMap = {};
        members.forEach(m => {
            if (!m.zone) return;
            if (!byZoneMap[m.zone]) byZoneMap[m.zone] = { total: 0, present: 0 };
            byZoneMap[m.zone].total++;
            if (m.present) byZoneMap[m.zone].present++;

            const unitKey = `${m.zone}|||${m.unit}`;
            if (m.unit) {
                if (!byUnitMap[unitKey]) byUnitMap[unitKey] = { zone: m.zone, unit: m.unit, total: 0, present: 0 };
                byUnitMap[unitKey].total++;
                if (m.present) byUnitMap[unitKey].present++;
            }
        });

        const byZone = Object.entries(byZoneMap)
            .map(([zone, s]) => ({ zone, present: s.present, total: s.total, percent: pct(s.present, s.total) }))
            .sort((a, b) => a.zone.localeCompare(b.zone));

        const byUnit = Object.values(byUnitMap)
            .map(s => ({ zone: s.zone, unit: s.unit, present: s.present, total: s.total, percent: pct(s.present, s.total) }))
            .sort((a, b) => a.zone.localeCompare(b.zone) || a.unit.localeCompare(b.unit));

        res.json({
            overall: { total, present, percent: pct(present, total), peaceRadioCount, zameelCount },
            byZone,
            byUnit
        });
    } catch (error) {
        console.error('Error building checkin report:', error);
        res.status(500).json({ error: 'Failed to build checkin report' });
    }
});

app.listen(port, () => {
    console.log(`Backend server strictly running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
});
