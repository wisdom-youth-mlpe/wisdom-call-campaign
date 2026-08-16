import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './CampaignPage.css';

interface Zone {
    name: string;
    units: string[];
}

interface CheckinMember {
    zone: string;
    unit: string;
    name: string;
    mobile: string;
    present: boolean;
    peaceRadio: boolean;
    zameel: boolean;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
    return (
        <div className="checkin-toggle-row">
            <span className="checkin-toggle-label">{label}</span>
            <span
                className={`toggle-track${checked ? ' toggle-track--on' : ''}`}
                onClick={() => onChange(!checked)}
                role="switch"
                aria-checked={checked}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!checked); } }}
            >
                <span className="toggle-thumb" />
            </span>
        </div>
    );
}

export default function CheckinPage() {
    const { token, logout, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [zones, setZones] = useState<Zone[]>([]);
    const [members, setMembers] = useState<CheckinMember[]>([]);
    const [selectedZone, setSelectedZone] = useState<string>('all');
    const [selectedUnit, setSelectedUnit] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [addFormOpen, setAddFormOpen] = useState(false);
    const [newZone, setNewZone] = useState('');
    const [newUnit, setNewUnit] = useState('');
    const [newName, setNewName] = useState('');
    const [newMobile, setNewMobile] = useState('');
    const [adding, setAdding] = useState(false);

    const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
    // Master admin, org-wide viewers (super_admin tab), and dual-listed mentors (orgViewer)
    const canAccessCheckin = user?.role === 'super-admin' || user?.role === 'viewer' || !!user?.orgViewer;

    // Everyone else is bounced back to the campaign page
    useEffect(() => {
        if (isLoading) return;
        if (!token) {
            navigate('/login');
            return;
        }
        if (!canAccessCheckin) {
            navigate('/');
        }
    }, [isLoading, token, canAccessCheckin, navigate]);

    useEffect(() => {
        if (isLoading || !token || !canAccessCheckin) return;
        const fetchZones = async () => {
            try {
                const response = await fetch(`${backendUrl}/api/dashboard/zones`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Failed to fetch zones');
                const data = await response.json();
                setZones(data.zones);
            } catch (error) {
                console.error('Error fetching zones:', error);
            }
        };
        fetchZones();
    }, [isLoading, token, canAccessCheckin, backendUrl]);

    const fetchMembers = async () => {
        try {
            const url = `${backendUrl}/api/checkin/members?zone=${encodeURIComponent(selectedZone)}&unit=${encodeURIComponent(selectedUnit)}`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch checkin members');
            const data = await response.json();
            setMembers(data.members);
        } catch (error) {
            console.error('Error fetching checkin members:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isLoading || !token || !canAccessCheckin) return;
        fetchMembers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, token, canAccessCheckin, selectedZone, selectedUnit, backendUrl]);

    const updateCheckin = async (member: CheckinMember, updates: Partial<Pick<CheckinMember, 'present' | 'peaceRadio' | 'zameel'>>) => {
        const next = { ...member, ...updates };

        setMembers(prev => prev.map(m =>
            (m.zone === member.zone && m.unit === member.unit && m.name === member.name) ? next : m
        ));

        try {
            const response = await fetch(`${backendUrl}/api/checkin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    zone: member.zone,
                    unit: member.unit,
                    name: member.name,
                    present: next.present,
                    peaceRadio: next.peaceRadio,
                    zameel: next.zameel
                })
            });
            if (!response.ok) throw new Error('Failed to update checkin');
        } catch (error) {
            console.error('Error updating checkin:', error);
            alert('Failed to save checkin. Please try again.');
        }
    };

    const handleAddAttendee = async () => {
        const zone = newZone.trim();
        const unit = newUnit.trim();
        const name = newName.trim();
        const mobile = newMobile.trim();

        if (!zone || !name || !mobile) {
            alert('Zone, name, and mobile number are required.');
            return;
        }

        setAdding(true);
        try {
            const response = await fetch(`${backendUrl}/api/checkin/attendee`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ zone, unit, name, mobile })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.message || 'Failed to add attendee.');
                return;
            }

            setNewZone('');
            setNewUnit('');
            setNewName('');
            setNewMobile('');
            setAddFormOpen(false);
            alert(`${name} added and marked present!`);
            fetchMembers();
        } catch (error) {
            console.error('Error adding attendee:', error);
            alert('Failed to add attendee. Please try again.');
        } finally {
            setAdding(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (isLoading || loading || !canAccessCheckin) {
        return <div className="campaign-loading">Loading check-in...</div>;
    }

    const unitOptions = selectedZone === 'all'
        ? []
        : (zones.find(z => z.name === selectedZone)?.units || []);

    // Unit suggestions for the add-attendee form: units of the typed zone if it matches
    // an existing one, otherwise every known unit as a general fallback
    const matchedZone = zones.find(z => z.name.toLowerCase() === newZone.trim().toLowerCase());
    const newUnitOptions = matchedZone
        ? matchedZone.units
        : Array.from(new Set(zones.flatMap(z => z.units))).sort();

    const searchLower = search.trim().toLowerCase();
    const visibleMembers = searchLower
        ? members.filter(m => m.name.toLowerCase().includes(searchLower) || m.mobile.includes(searchLower))
        : members;

    const presentCount = visibleMembers.filter(m => m.present).length;
    const presentPercent = visibleMembers.length > 0 ? Math.round((presentCount / visibleMembers.length) * 100) : 0;

    return (
        <div className="campaign-page">
            <header className="campaign-header">
                <h1>🧾 Check-in</h1>
                <div className="campaign-header-actions">
                    <button className="header-btn" onClick={() => setAddFormOpen(!addFormOpen)} title="Add Attendee">
                        ➕
                    </button>
                    <button className="header-btn" onClick={() => navigate('/checkin-report')} title="Check-in Report">
                        📊
                    </button>
                    <button className="header-btn" onClick={() => navigate('/')} title="Call Campaign">
                        📞
                    </button>
                    <button className="header-btn" onClick={handleLogout} title="Logout">
                        ⏻
                    </button>
                </div>
            </header>

            <main className="campaign-content">
                {addFormOpen && (
                    <div className="template-card">
                        <label style={{ fontWeight: 700, fontSize: '15px', color: '#25D366', display: 'block', marginBottom: '12px' }}>
                            ➕ Add Attendee
                        </label>

                        <div className="filter-group">
                            <label htmlFor="new-attendee-zone">Zone:</label>
                            <input
                                id="new-attendee-zone"
                                type="text"
                                list="checkin-zone-datalist"
                                value={newZone}
                                onChange={(e) => setNewZone(e.target.value)}
                                placeholder="Zone name..."
                                className="zone-select"
                            />
                            <datalist id="checkin-zone-datalist">
                                {zones.map(zone => (
                                    <option key={zone.name} value={zone.name} />
                                ))}
                            </datalist>
                        </div>

                        <div className="filter-group">
                            <label htmlFor="new-attendee-unit">Unit:</label>
                            <input
                                id="new-attendee-unit"
                                type="text"
                                list="checkin-unit-datalist"
                                value={newUnit}
                                onChange={(e) => setNewUnit(e.target.value)}
                                placeholder="Unit name..."
                                className="zone-select"
                            />
                            <datalist id="checkin-unit-datalist">
                                {newUnitOptions.map(unit => (
                                    <option key={unit} value={unit} />
                                ))}
                            </datalist>
                        </div>

                        <div className="filter-group">
                            <label htmlFor="new-attendee-name">Name:</label>
                            <input
                                id="new-attendee-name"
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Full name..."
                                className="zone-select"
                            />
                        </div>

                        <div className="filter-group">
                            <label htmlFor="new-attendee-mobile">Mobile Number:</label>
                            <input
                                id="new-attendee-mobile"
                                type="tel"
                                value={newMobile}
                                onChange={(e) => setNewMobile(e.target.value)}
                                placeholder="Mobile number..."
                                className="zone-select"
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                            <button onClick={handleAddAttendee} disabled={adding}
                                className="template-btn"
                                style={{
                                    background: adding ? '#aaa' : '#25D366', color: 'white', border: 'none',
                                    cursor: adding ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 3px 10px rgba(37,211,102,0.3)'
                                }}>
                                {adding ? '⏳ Adding...' : '✅ Add & Check In'}
                            </button>
                            <button onClick={() => setAddFormOpen(false)}
                                className="template-btn"
                                style={{ background: 'transparent', color: '#334155', border: '1px solid #cbd5e1' }}>
                                Cancel
                            </button>
                        </div>
                        <p style={{ color: '#aaa', fontSize: '12px', marginTop: '12px' }}>
                            ℹ️ Adds a new row to the sheet and marks them Present right away.
                        </p>
                    </div>
                )}

                <div className="filters-card">
                    <div className="filter-group">
                        <label htmlFor="checkin-zone-select">Zone:</label>
                        <select
                            id="checkin-zone-select"
                            value={selectedZone}
                            onChange={(e) => {
                                setSelectedZone(e.target.value);
                                setSelectedUnit('all');
                            }}
                            className="zone-select"
                        >
                            <option value="all">All Zones</option>
                            {zones.map(zone => (
                                <option key={zone.name} value={zone.name}>{zone.name}</option>
                            ))}
                        </select>
                    </div>

                    {selectedZone !== 'all' && unitOptions.length > 0 && (
                        <div className="filter-group">
                            <label htmlFor="checkin-unit-select">Unit:</label>
                            <select
                                id="checkin-unit-select"
                                value={selectedUnit}
                                onChange={(e) => setSelectedUnit(e.target.value)}
                                className="zone-select"
                            >
                                <option value="all">All Units</option>
                                {unitOptions.map(unit => (
                                    <option key={unit} value={unit}>{unit}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="filter-group">
                        <label htmlFor="checkin-search">Search:</label>
                        <input
                            id="checkin-search"
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Name or mobile number..."
                            className="zone-select"
                        />
                    </div>
                </div>

                {visibleMembers.length > 0 && (
                    <div className="stat-tile-grid stat-tile-grid--compact">
                        <div className="stat-tile stat-tile--neutral">
                            <div className="stat-tile-value">{visibleMembers.length}</div>
                            <div className="stat-tile-label">Total</div>
                        </div>
                        <div className="stat-tile stat-tile--good">
                            <div className="stat-tile-value">{presentCount}</div>
                            <div className="stat-tile-label">Present</div>
                        </div>
                        <div className="stat-tile stat-tile--warning">
                            <div className="stat-tile-value">{presentPercent}%</div>
                            <div className="stat-tile-label">Checked In</div>
                        </div>
                    </div>
                )}

                <div className="members-list">
                    <h3>🧾 Check-in List - {selectedZone === 'all' ? 'All Zones' : selectedZone} ({visibleMembers.length})</h3>

                    {visibleMembers.length === 0 ? (
                        <p className="no-data">No members found matching criteria!</p>
                    ) : (
                        <div className="campaign-grid">
                            {visibleMembers.map((member, idx) => (
                                <div
                                    key={idx}
                                    className="member-card"
                                    style={member.present ? { background: '#f0fdf4', border: '1px solid #86efac' } : { background: 'white', border: '1px solid #eee' }}
                                >
                                    <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '5px' }}>
                                        {member.present ? '✅ ' : ''}{member.name}
                                    </div>
                                    <div style={{ color: '#666', fontSize: '14px', marginBottom: '5px' }}>
                                        {member.unit ? `${member.unit} · ${member.zone}` : member.zone}
                                    </div>
                                    <div style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>{member.mobile || 'No Mobile'}</div>

                                    <Toggle
                                        checked={member.present}
                                        onChange={(v) => updateCheckin(member, { present: v })}
                                        label="Present"
                                    />
                                    <Toggle
                                        checked={member.peaceRadio}
                                        onChange={(v) => updateCheckin(member, { peaceRadio: v })}
                                        label="Peace Radio"
                                    />
                                    <Toggle
                                        checked={member.zameel}
                                        onChange={(v) => updateCheckin(member, { zameel: v })}
                                        label="Zameel"
                                    />

                                    {member.mobile && (
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                                            <a href={`tel:${member.mobile}`} className="action-btn" style={{ background: '#3B82F6' }}>
                                                📞 Call
                                            </a>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
