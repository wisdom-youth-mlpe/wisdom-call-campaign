import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './CampaignPage.css';

interface Zone {
    name: string;
    units: string[];
    total: number;
    called: number;
}

interface Member {
    zone: string;
    unit: string;
    name: string;
    mobile: string;
    callStatus?: string;
    callRemarks?: string;
    mentor: string;
}

const CALL_STATUS_OPTIONS = [
    { value: '', label: 'Select Status' },
    { value: 'vilichu_pankedukkum', label: 'വിളിച്ചു, പങ്കെടുക്കും' },
    { value: 'vilichu_pankedukkilla', label: 'വിളിച്ചു, പങ്കെടുക്കില്ല' },
    { value: 'phone_eduthilla_whatsapp', label: 'ഫോൺ എടുത്തില്ല, വാട്സാപ്പ് അയച്ചു' },
    { value: 'phone_eduthilla', label: 'ഫോൺ എടുത്തില്ല' },
    { value: 'call_pokunnilla', label: 'കോൾ പോകുന്നില്ല' },
    { value: 'mattullava', label: 'മറ്റുള്ളവ' }
];

const getCallStatusIcon = (callStatus?: string): { icon: string; color: string } | null => {
    if (!callStatus) return null;
    if (callStatus === 'vilichu_pankedukkum') return { icon: '✅', color: '#22c55e' };
    if (callStatus === 'vilichu_pankedukkilla') return { icon: '❌', color: '#ef4444' };
    // All other non-empty statuses get a sad smiley
    return { icon: '😔', color: '#f59e0b' };
};

const getTileStyle = (callStatus?: string): React.CSSProperties => {
    if (!callStatus) {
        // Not called yet — neutral white
        return { background: 'white', border: '1px solid #eee' };
    }
    if (callStatus === 'vilichu_pankedukkum') {
        return { background: '#f0fdf4', border: '1px solid #86efac' };
    }
    if (callStatus === 'vilichu_pankedukkilla') {
        return { background: '#fff1f2', border: '1px solid #fca5a5' };
    }
    // Any other called status → amber tint
    return { background: '#fffbeb', border: '1px solid #fcd34d' };
};

export default function CampaignPage() {
    const { token, logout, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [zones, setZones] = useState<Zone[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [selectedZone, setSelectedZone] = useState<string>('all');
    const [selectedUnit, setSelectedUnit] = useState<string>('all');
    const [loading, setLoading] = useState(true);
    const [campaignMessage, setCampaignMessage] = useState('Assalamu Alaikum');
    const [callStatusFilter, setCallStatusFilter] = useState<string>('all');
    const [mentorFilter, setMentorFilter] = useState<string>('all');
    const [messageSaving, setMessageSaving] = useState(false);
    const [statsExpanded, setStatsExpanded] = useState(false);
    const [listExpanded, setListExpanded] = useState(false);
    const [templateOpen, setTemplateOpen] = useState(false);

    const isSuperAdmin = user?.role === 'super-admin';
    const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    useEffect(() => {
        // Wait for auth loading to complete
        if (isLoading) return;

        if (!token) {
            navigate('/login');
            return;
        }
        fetchZones();
        fetchConfig();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, navigate, isLoading]);

    useEffect(() => {
        if (token) {
            fetchMembers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedZone, selectedUnit, token]);

    const fetchConfig = async () => {
        try {
            const response = await fetch(`${backendUrl}/api/config`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            if (data.message) setCampaignMessage(data.message);
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    const saveMessage = async () => {
        setMessageSaving(true);
        try {
            const response = await fetch(`${backendUrl}/api/config/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ message: campaignMessage })
            });
            if (!response.ok) throw new Error('Failed to save');
            alert('Message saved successfully!');
        } catch (error) {
            console.error('Error saving message:', error);
            alert('Failed to save message. Please try again.');
        } finally {
            setMessageSaving(false);
        }
    };

    const fetchZones = async () => {
        try {
            const response = await fetch(`${backendUrl}/api/dashboard/zones`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch zones');

            const data = await response.json();
            setZones(data.zones);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching zones:', error);
            setLoading(false);
        }
    };

    const fetchMembers = async () => {
        try {
            const url = `${backendUrl}/api/dashboard/members?zone=${encodeURIComponent(selectedZone)}&unit=${encodeURIComponent(selectedUnit)}`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch members');

            const data = await response.json();
            setMembers(data.members);
        } catch (error) {
            console.error('Error fetching members:', error);
        }
    };

    const updateCallStatus = async (member: Member, status: string, remarks: string) => {
        try {
            // Update local state first for immediate UI response
            setMembers(prevMembers => prevMembers.map(m => {
                if (m.zone === member.zone && m.unit === member.unit && m.name === member.name) {
                    return { ...m, callStatus: status, callRemarks: remarks };
                }
                return m;
            }));

            const response = await fetch(`${backendUrl}/api/call-status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    zone: member.zone,
                    unit: member.unit,
                    name: member.name,
                    callStatus: status,
                    remarks: remarks
                })
            });

            if (!response.ok) throw new Error('Failed to update call status');

        } catch (error) {
            console.error('Error updating call status:', error);
            alert('Failed to save call status. Please try again.');
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (isLoading || loading) {
        return <div className="campaign-loading">Loading campaign...</div>;
    }

    // Units of the currently selected zone (for the unit filter)
    const unitOptions = selectedZone === 'all'
        ? []
        : (zones.find(z => z.name === selectedZone)?.units || []);

    // Mentor filter (super-admin only, client-side)
    const mentorOptions = isSuperAdmin
        ? Array.from(new Set(members.map(m => m.mentor).filter(Boolean))).sort()
        : [];
    const visibleMembers = (isSuperAdmin && mentorFilter !== 'all')
        ? members.filter(m => m.mentor === mentorFilter)
        : members;

    // Progress across the visible set (before the call-status filter)
    const calledCount = visibleMembers.filter(m => m.callStatus).length;
    const progressPercent = visibleMembers.length > 0
        ? Math.round((calledCount / visibleMembers.length) * 100)
        : 0;

    const listMembers = visibleMembers.filter(m => {
        if (callStatusFilter === 'all') return true;
        if (callStatusFilter === 'not_called') return !m.callStatus;
        return m.callStatus === callStatusFilter;
    });

    return (
        <div className="campaign-page">
            {/* Sticky header */}
            <header className="campaign-header">
                <h1>📞 Call Campaign</h1>
                <div className="campaign-header-actions">
                    <button
                        className="header-btn"
                        onClick={() => navigate('/report')}
                        title="Report"
                    >
                        📊
                    </button>
                    <button
                        className="header-btn"
                        onClick={() => setTemplateOpen(!templateOpen)}
                        title="WhatsApp Message Template"
                    >
                        💬
                    </button>
                    <button className="header-btn" onClick={handleLogout} title="Logout">
                        ⏻
                    </button>
                </div>
            </header>

            <main className="campaign-content">
                {/* WhatsApp Message Template (collapsible) */}
                {templateOpen && (
                    <div className="template-card">
                        <label style={{ fontWeight: 700, fontSize: '15px', color: '#25D366', display: 'block', marginBottom: '12px' }}>
                            📝 Message Template
                        </label>
                        <textarea
                            value={campaignMessage}
                            onChange={(e) => setCampaignMessage(e.target.value)}
                            placeholder="Enter the default WhatsApp message..."
                            className="template-textarea"
                            onFocus={(e) => e.currentTarget.style.border = '2px solid #25D366'}
                            onBlur={(e) => e.currentTarget.style.border = '2px solid #e0f2e9'}
                        />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                            <button onClick={saveMessage} disabled={messageSaving}
                                className="template-btn"
                                style={{
                                    background: messageSaving ? '#aaa' : '#25D366', color: 'white', border: 'none',
                                    cursor: messageSaving ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 3px 10px rgba(37,211,102,0.3)'
                                }}>
                                {messageSaving ? '⏳ Saving...' : '💾 Save'}
                            </button>
                            <button onClick={async () => { await navigator.clipboard.writeText(campaignMessage); alert('Copied!'); }}
                                className="template-btn"
                                style={{ background: 'transparent', color: '#25D366', border: '2px solid #25D366' }}>📋 Copy</button>
                        </div>
                        <p style={{ color: '#aaa', fontSize: '12px', marginTop: '12px' }}>
                            ℹ️ Message is saved to the Google Sheet and used in the WhatsApp button below.
                        </p>
                    </div>
                )}

                {/* Filters */}
                <div className="filters-card">
                    <div className="filter-group">
                        <label htmlFor="campaign-zone-select">Zone:</label>
                        <select
                            id="campaign-zone-select"
                            value={selectedZone}
                            onChange={(e) => {
                                setSelectedZone(e.target.value);
                                setSelectedUnit('all');
                            }}
                            className="zone-select"
                        >
                            <option value="all">All Zones</option>
                            {zones.map(zone => (
                                <option key={zone.name} value={zone.name}>
                                    {zone.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedZone !== 'all' && unitOptions.length > 0 && (
                        <div className="filter-group">
                            <label htmlFor="campaign-unit-select">Unit:</label>
                            <select
                                id="campaign-unit-select"
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

                    {isSuperAdmin && mentorOptions.length > 0 && (
                        <div className="filter-group">
                            <label htmlFor="campaign-mentor-select">Mentor:</label>
                            <select
                                id="campaign-mentor-select"
                                value={mentorFilter}
                                onChange={(e) => setMentorFilter(e.target.value)}
                                className="zone-select"
                            >
                                <option value="all">All Mentors</option>
                                {mentorOptions.map(mentor => (
                                    <option key={mentor} value={mentor}>{mentor}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="filter-group">
                        <label htmlFor="campaign-call-status-filter">Call Status:</label>
                        <select
                            id="campaign-call-status-filter"
                            value={callStatusFilter}
                            onChange={(e) => setCallStatusFilter(e.target.value)}
                            className="zone-select"
                        >
                            <option value="all">All</option>
                            <option value="not_called">🔵 Not Called Yet</option>
                            <option value="vilichu_pankedukkum">✅ വിളിച്ചു, പങ്കെടുക്കും</option>
                            <option value="vilichu_pankedukkilla">❌ വിളിച്ചു, പങ്കെടുക്കില്ല</option>
                            <option value="phone_eduthilla_whatsapp">😔 ഫോൺ എടുത്തില്ല, വാട്സാപ്പ് അയച്ചു</option>
                            <option value="phone_eduthilla">😔 ഫോൺ എടുത്തില്ല</option>
                            <option value="call_pokunnilla">😔 കോൾ പോകുന്നില്ല</option>
                            <option value="mattullava">😔 മറ്റുള്ളവ</option>
                        </select>
                    </div>
                </div>

                {/* Progress strip */}
                {visibleMembers.length > 0 && (
                    <div className="progress-strip">
                        <div className="progress-label">
                            <span>{calledCount} / {visibleMembers.length} called</span>
                            <span>{progressPercent}%</span>
                        </div>
                        <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                    </div>
                )}

                {/* ── WhatsApp Summary Message ── */}
                {(() => {
                    if (selectedZone !== 'all') return null; // Only show on All Zones

                    // Build per-zone uncalled count from the visible members
                    const zoneUncalledMap: Record<string, number> = {};
                    visibleMembers.forEach(m => {
                        if (!m.callStatus) {
                            zoneUncalledMap[m.zone] = (zoneUncalledMap[m.zone] || 0) + 1;
                        }
                    });
                    const zoneEntries = Object.entries(zoneUncalledMap).filter(([, count]) => count > 0);
                    if (zoneEntries.length === 0) return null;

                    const waMessage = `കോൾ ഇനിയും ബാക്കിയുള്ളത്...\n\n` +
                        zoneEntries.map(([zone, count]) => `${zone} (${count})`).join('\n');

                    const copyWaSummary = async () => {
                        try {
                            await navigator.clipboard.writeText(waMessage);
                            alert('Copied to clipboard!');
                        } catch {
                            alert('Failed to copy. Please copy manually.');
                        }
                    };

                    return (
                        <div style={{
                            background: '#f0fdf4',
                            border: '1.5px solid #86efac',
                            borderRadius: 16,
                            padding: '16px 20px',
                            marginBottom: 16,
                            position: 'relative'
                        }}>
                            <div
                                onClick={() => setStatsExpanded(!statsExpanded)}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                            >
                                <div style={{ fontWeight: 800, fontSize: 15, color: '#065f46', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    💬 WhatsApp Summary Stats
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {statsExpanded && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); copyWaSummary(); }}
                                            style={{
                                                background: '#25D366', color: 'white', border: 'none',
                                                borderRadius: 10, padding: '6px 14px', cursor: 'pointer',
                                                fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                                                display: 'flex', alignItems: 'center', gap: 6
                                            }}
                                        >
                                            📋 Copy
                                        </button>
                                    )}
                                    <span style={{ fontSize: 18, color: '#065f46', userSelect: 'none' }}>
                                        {statsExpanded ? '▲' : '▼'}
                                    </span>
                                </div>
                            </div>

                            {statsExpanded && (
                                <pre style={{
                                    margin: '14px 0 0', fontFamily: 'Noto Sans Malayalam, Quicksand, sans-serif',
                                    fontSize: 14, color: '#1a1f2e', lineHeight: 1.8,
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    background: 'rgba(255,255,255,0.6)', borderRadius: 10,
                                    padding: '12px 16px'
                                }}>
                                    {waMessage}
                                </pre>
                            )}
                        </div>
                    );
                })()}

                {/* ── WhatsApp List Message ── */}
                {(() => {
                    if (selectedZone === 'all') return null; // Only show for a specific zone
                    if (visibleMembers.length === 0) return null;

                    const waMessage = `${selectedZone} മണ്ഡലത്തിലെ അംഗങ്ങൾ\n\n` +
                        visibleMembers.map((m, idx) => `${idx + 1}. ${m.name} (${m.unit}) ${m.mobile}`).join('\n');

                    const copyWaList = async () => {
                        try {
                            await navigator.clipboard.writeText(waMessage);
                            alert('Copied to clipboard!');
                        } catch {
                            alert('Failed to copy. Please copy manually.');
                        }
                    };

                    return (
                        <div style={{
                            background: '#f8fafc',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: 16,
                            padding: '16px 20px',
                            marginBottom: 28,
                            position: 'relative'
                        }}>
                            <div
                                onClick={() => setListExpanded(!listExpanded)}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                            >
                                <div style={{ fontWeight: 800, fontSize: 15, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    💬 WhatsApp Member List
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {listExpanded && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); copyWaList(); }}
                                            style={{
                                                background: '#25D366', color: 'white', border: 'none',
                                                borderRadius: 10, padding: '6px 14px', cursor: 'pointer',
                                                fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                                                display: 'flex', alignItems: 'center', gap: 6
                                            }}
                                        >
                                            📋 Copy
                                        </button>
                                    )}
                                    <span style={{ fontSize: 18, color: '#334155', userSelect: 'none' }}>
                                        {listExpanded ? '▲' : '▼'}
                                    </span>
                                </div>
                            </div>

                            {listExpanded && (
                                <pre style={{
                                    margin: '14px 0 0', fontFamily: 'Noto Sans Malayalam, Quicksand, sans-serif',
                                    fontSize: 14, color: '#1a1f2e', lineHeight: 1.8,
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    background: 'rgba(255,255,255,0.6)', borderRadius: 10,
                                    padding: '12px 16px', maxHeight: '300px', overflowY: 'auto'
                                }}>
                                    {waMessage}
                                </pre>
                            )}
                        </div>
                    );
                })()}

                {/* Campaign List */}
                <div className="members-list">
                    <h3>📞 Call List - {selectedZone === 'all' ? 'All Zones' : selectedZone} ({listMembers.length})</h3>

                    {listMembers.length === 0 ? (
                        <p className="no-data">No members found matching criteria!</p>
                    ) : (
                        <div className="campaign-grid">
                            {listMembers.map((member, idx) => (
                                <div key={idx} className="member-card" style={getTileStyle(member.callStatus)}>
                                    <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {member.name}
                                        {getCallStatusIcon(member.callStatus) && (
                                            <span
                                                title={CALL_STATUS_OPTIONS.find(o => o.value === member.callStatus)?.label || member.callStatus}
                                                style={{ fontSize: '20px', lineHeight: 1 }}
                                            >
                                                {getCallStatusIcon(member.callStatus)!.icon}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ color: '#666', fontSize: '14px', marginBottom: '5px' }}>
                                        {member.unit ? `${member.unit} · ${member.zone}` : member.zone}
                                    </div>
                                    <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>{member.mobile || 'No Mobile'}</div>
                                    {isSuperAdmin && member.mentor && (
                                        <div style={{ color: '#7c3aed', fontSize: '13px', marginBottom: '10px', fontWeight: 600 }}>
                                            👤 {member.mentor}
                                        </div>
                                    )}

                                    {/* Call Status Dropdown */}
                                    <div style={{ marginBottom: '15px' }}>
                                        <select
                                            value={member.callStatus || ''}
                                            onChange={(e) => updateCallStatus(member, e.target.value, member.callRemarks || '')}
                                            className="status-select"
                                        >
                                            {CALL_STATUS_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>

                                        {(member.callStatus === 'vilichu_pankedukkilla' || member.callStatus === 'mattullava') && (
                                            <textarea
                                                placeholder="Reason / Notes..."
                                                value={member.callRemarks || ''}
                                                className="remarks-textarea"
                                                onChange={(e) => {
                                                    // Update local state immediately for smooth typing
                                                    const newRemarks = e.target.value;
                                                    setMembers(prev => prev.map(m =>
                                                        (m.zone === member.zone && m.unit === member.unit && m.name === member.name)
                                                            ? { ...m, callRemarks: newRemarks }
                                                            : m
                                                    ));
                                                }}
                                                onBlur={(e) => updateCallStatus(member, member.callStatus || '', e.target.value)}
                                            />
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        {member.mobile && (
                                            <>
                                                <a
                                                    href={`tel:${member.mobile}`}
                                                    className="action-btn"
                                                    style={{ background: '#3B82F6' }}
                                                >
                                                    📞 Call
                                                </a>
                                                <a
                                                    href={(() => { const digits = member.mobile.replace(/\D/g, ''); const withCountry = digits.startsWith('91') ? digits : `91${digits}`; return `https://wa.me/${withCountry}?text=${encodeURIComponent(campaignMessage)}`; })()}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="action-btn"
                                                    style={{ background: '#25D366' }}
                                                >
                                                    💬 WhatsApp
                                                </a>
                                            </>
                                        )}
                                        {!member.mobile && (
                                            <span style={{ color: '#999', fontSize: '14px', fontStyle: 'italic' }}>No Number Available</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
