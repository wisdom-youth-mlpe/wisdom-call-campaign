import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './CampaignPage.css';

interface GroupStat {
    total: number;
    called: number;
    percent: number;
}

interface StatusCount {
    value: string;
    label: string;
    count: number;
}

interface Zone {
    name: string;
    units: string[];
    total: number;
    called: number;
}

interface Report {
    overall: { total: number; called: number; remaining: number; percent: number };
    byStatus: StatusCount[];
    byZone: (GroupStat & { zone: string })[];
    byMentor?: (GroupStat & { mentor: string; mentorName?: string })[];
    pending: { zone: string; unit: string; name: string; mobile: string; mentor: string; mentorName?: string }[];
    completed: { zone: string; unit: string; name: string; mobile: string; mentor: string; mentorName?: string; callStatus: string; callRemarks: string }[];
}

const STATUS_ICONS: Record<string, string> = {
    '': '🔵',
    vilichu_pankedukkum: '✅',
    vilichu_pankedukkilla: '❌',
    phone_eduthilla_whatsapp: '😔',
    phone_eduthilla: '😔',
    call_pokunnilla: '😔',
    mattullava: '😔'
};

// Reuses the same good/critical/warning/neutral meaning already used for call-status tiles on the Call Campaign page
const STATUS_VARIANTS: Record<string, string> = {
    '': 'neutral',
    vilichu_pankedukkum: 'good',
    vilichu_pankedukkilla: 'critical',
    phone_eduthilla_whatsapp: 'warning',
    phone_eduthilla: 'warning',
    call_pokunnilla: 'warning',
    mattullava: 'warning'
};

const toWhatsAppNumber = (mobile: string) => {
    const digits = mobile.replace(/\D/g, '');
    return digits.startsWith('91') ? digits : `91${digits}`;
};

function buildReportMessage(report: Report, canSeeAllMentors: boolean, displayName: string, zoneLabel?: string): string {
    let msg = `📞 Call Campaign Report${zoneLabel ? ` — ${zoneLabel}` : ''}${!canSeeAllMentors && displayName ? ` — ${displayName}` : ''}\n\n`;
    msg += `Total: ${report.overall.total}\n`;
    msg += `✅ Completed: ${report.overall.called} (${report.overall.percent}%)\n`;
    msg += `⏳ Remaining: ${report.overall.remaining}\n\n`;
    msg += `Response breakdown:\n`;
    report.byStatus.forEach(s => {
        msg += `${STATUS_ICONS[s.value] || '•'} ${s.label}: ${s.count}\n`;
    });
    if (canSeeAllMentors && report.byMentor && report.byMentor.length > 0) {
        msg += `\n👤 Mentor-wise progress:\n`;
        report.byMentor.forEach(m => {
            msg += `${m.mentorName || m.mentor}: ${m.called}/${m.total} (${m.percent}%)\n`;
        });
    }
    return msg;
}

// Short Malayalam zone-status message for quick sharing to a zone's WhatsApp group
function buildZoneMessage(report: Report, zoneName: string): string {
    return `📞 ${zoneName} മണ്ഡലം - കോൾ സ്റ്റാറ്റസ്\n\n` +
        `ആകെ: ${report.overall.total}\n` +
        `പൂർത്തിയായത്: ${report.overall.called} (${report.overall.percent}%)\n` +
        `ബാക്കിയുള്ളത്: ${report.overall.remaining}`;
}

// Malayalam nudge for a specific mentor, built from their By Mentor row
function buildMentorReminder(mentorLabel: string, called: number, total: number): string {
    const remaining = total - called;
    if (remaining <= 0) {
        return `${mentorLabel},\n\n🎉 നിങ്ങളുടെ എല്ലാ കോളുകളും പൂർത്തിയാക്കിയതിന് നന്ദി!`;
    }
    return `${mentorLabel},\n\nനിങ്ങൾക്ക് ഇനിയും ${remaining} കോളുകൾ ബാക്കിയുണ്ട് (${called}/${total} പൂർത്തിയായി). ദയവായി വിളിച്ചു റിപ്പോർട്ട് ചെയ്യുക.`;
}

export default function ReportPage({ orgWide = false }: { orgWide?: boolean }) {
    const { token, logout, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [report, setReport] = useState<Report | null>(null);
    const [zones, setZones] = useState<Zone[]>([]);
    const [selectedZone, setSelectedZone] = useState<string>('all');
    const [selectedUnit, setSelectedUnit] = useState<string>('all');
    const [loading, setLoading] = useState(true);

    const canSeeAllMentors = user?.role === 'super-admin' || user?.role === 'viewer' || (orgWide && !!user?.orgViewer);
    // Shows the "👑 Super Admin" entry point: a mentor who is also listed in the super_admin
    // tab, viewing their own (non-org-wide) report — pure viewers already see everything by default
    const showSuperAdminLink = !orgWide && user?.role !== 'viewer' && !!user?.orgViewer;
    const displayName = user?.name || user?.username || '';
    const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
    const allParam = orgWide ? '&all=true' : '';

    // Zones (for the filter dropdowns) — fetched once
    useEffect(() => {
        if (isLoading) return;
        if (!token) {
            navigate('/login');
            return;
        }
        const fetchZones = async () => {
            try {
                const response = await fetch(`${backendUrl}/api/dashboard/zones?${orgWide ? 'all=true' : ''}`, {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, navigate, isLoading]);

    // Report — refetched whenever the zone/unit filter changes
    useEffect(() => {
        if (isLoading || !token) return;
        const fetchReport = async () => {
            try {
                const url = `${backendUrl}/api/report?zone=${encodeURIComponent(selectedZone)}&unit=${encodeURIComponent(selectedUnit)}${allParam}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Failed to fetch report');
                setReport(await response.json());
            } catch (error) {
                console.error('Error fetching report:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchReport();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, isLoading, selectedZone, selectedUnit, orgWide]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (isLoading || loading) {
        return <div className="campaign-loading">Loading report...</div>;
    }

    if (!report) {
        return <div className="campaign-loading">Failed to load report.</div>;
    }

    // Units of the currently selected zone (for the unit filter)
    const unitOptions = selectedZone === 'all'
        ? []
        : (zones.find(z => z.name === selectedZone)?.units || []);

    // Group pending people by zone for readability
    const pendingByZone: Record<string, Report['pending']> = {};
    report.pending.forEach(p => {
        const key = p.zone || 'Unknown';
        if (!pendingByZone[key]) pendingByZone[key] = [];
        pendingByZone[key].push(p);
    });

    // Group completed people by zone for readability
    const completedByZone: Record<string, Report['completed']> = {};
    report.completed.forEach(c => {
        const key = c.zone || 'Unknown';
        if (!completedByZone[key]) completedByZone[key] = [];
        completedByZone[key].push(c);
    });
    const labelByStatus = Object.fromEntries(report.byStatus.map(s => [s.value, s.label]));

    return (
        <div className="campaign-page">
            <header className="campaign-header">
                <h1>{orgWide ? '👑 Org-Wide Report' : '📊 Report'}</h1>
                <div className="campaign-header-actions">
                    {orgWide && (
                        <button className="header-btn" onClick={() => navigate('/report')} title="My Report">
                            📊
                        </button>
                    )}
                    {showSuperAdminLink && (
                        <button className="header-btn" onClick={() => navigate('/admin-report')} title="Super Admin: Org-Wide Report">
                            👑
                        </button>
                    )}
                    {user?.role === 'super-admin' && (
                        <button className="header-btn" onClick={() => navigate('/checkin')} title="Event Check-in">
                            🧾
                        </button>
                    )}
                    {user?.role !== 'viewer' && (
                        <button className="header-btn" onClick={() => navigate('/')} title="Call Campaign">
                            📞
                        </button>
                    )}
                    <button className="header-btn" onClick={handleLogout} title="Logout">
                        ⏻
                    </button>
                </div>
            </header>

            <main className="campaign-content">
                {/* Zone / Unit filters */}
                <div className="filters-card">
                    <div className="filter-group">
                        <label htmlFor="report-zone-select">Zone:</label>
                        <select
                            id="report-zone-select"
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
                            <label htmlFor="report-unit-select">Unit:</label>
                            <select
                                id="report-unit-select"
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
                </div>

                {/* Overall progress */}
                <div className="report-section">
                    <h3>
                        Overall Progress
                        {selectedZone !== 'all' ? ` — ${selectedZone}${selectedUnit !== 'all' ? ` / ${selectedUnit}` : ''}` : ''}
                        {!canSeeAllMentors && displayName ? ` — ${displayName}` : ''}
                    </h3>
                    <div className="report-big-percent">{report.overall.percent}%</div>
                    <div className="progress-track" style={{ marginTop: 12 }}>
                        <div className="progress-fill" style={{ width: `${report.overall.percent}%` }} />
                    </div>

                    <div className="stat-tile-grid">
                        <div className="stat-tile stat-tile--neutral">
                            <div className="stat-tile-value">{report.overall.total}</div>
                            <div className="stat-tile-label">Total</div>
                        </div>
                        <div className="stat-tile stat-tile--good">
                            <div className="stat-tile-value">{report.overall.called}</div>
                            <div className="stat-tile-label">Completed</div>
                        </div>
                        <div className="stat-tile stat-tile--warning">
                            <div className="stat-tile-value">{report.overall.remaining}</div>
                            <div className="stat-tile-label">Remaining</div>
                        </div>
                    </div>

                    <button
                        onClick={async () => {
                            try {
                                const zoneLabel = selectedZone !== 'all' ? `${selectedZone}${selectedUnit !== 'all' ? ` / ${selectedUnit}` : ''}` : undefined;
                                await navigator.clipboard.writeText(buildReportMessage(report, canSeeAllMentors, displayName, zoneLabel));
                                alert('Report copied to clipboard!');
                            } catch {
                                alert('Failed to copy. Please copy manually.');
                            }
                        }}
                        className="template-btn"
                        style={{ background: '#25D366', color: 'white', border: 'none', marginTop: 16, width: '100%', boxShadow: '0 3px 10px rgba(37,211,102,0.3)' }}
                    >
                        📋 Copy WhatsApp Report
                    </button>

                    {selectedZone !== 'all' && (
                        <button
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(buildZoneMessage(report, selectedZone));
                                    alert('Zone update copied to clipboard!');
                                } catch {
                                    alert('Failed to copy. Please copy manually.');
                                }
                            }}
                            className="template-btn"
                            style={{ background: 'transparent', color: '#25D366', border: '2px solid #25D366', marginTop: 10, width: '100%' }}
                        >
                            📋 Copy Zone Update ({selectedZone})
                        </button>
                    )}
                </div>

                {/* Breakdown by response */}
                <div className="report-section">
                    <h3>📋 By Response</h3>
                    <div className="stat-tile-grid stat-tile-grid--status">
                        {report.byStatus.map(s => (
                            <div key={s.value || 'not_called'} className={`stat-tile stat-tile--${STATUS_VARIANTS[s.value] || 'neutral'}`}>
                                <div className="stat-tile-icon">{STATUS_ICONS[s.value] || '•'}</div>
                                <div className="stat-tile-value">{s.count}</div>
                                <div className="stat-tile-label">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Per-mentor breakdown (org-wide roles only) */}
                {canSeeAllMentors && report.byMentor && report.byMentor.length > 0 && (
                    <div className="report-section">
                        <h3>👤 By Mentor</h3>
                        <div className="report-table-wrap">
                            <table className="report-table">
                                <thead>
                                    <tr>
                                        <th>Mentor</th>
                                        <th>Called</th>
                                        <th>Total</th>
                                        <th>%</th>
                                        <th>Remind</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byMentor.map(m => {
                                        const label = m.mentorName || m.mentor;
                                        const waHref = `https://wa.me/${toWhatsAppNumber(m.mentor)}?text=${encodeURIComponent(buildMentorReminder(label, m.called, m.total))}`;
                                        return (
                                            <tr key={m.mentor}>
                                                <td>{label}</td>
                                                <td>{m.called}</td>
                                                <td>{m.total}</td>
                                                <td style={{ fontWeight: 700, color: m.percent === 100 ? '#16a34a' : '#1a1f2e' }}>
                                                    {m.percent}%
                                                </td>
                                                <td>
                                                    <a href={waHref} target="_blank" rel="noopener noreferrer" title={`Remind ${label} on WhatsApp`}>
                                                        💬
                                                    </a>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Per-zone breakdown */}
                {report.byZone.length > 0 && (
                    <div className="report-section">
                        <h3>📍 By Zone</h3>
                        <div className="report-table-wrap">
                            <table className="report-table">
                                <thead>
                                    <tr>
                                        <th>Zone</th>
                                        <th>Called</th>
                                        <th>Total</th>
                                        <th>%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byZone.map(z => (
                                        <tr key={z.zone}>
                                            <td>{z.zone}</td>
                                            <td>{z.called}</td>
                                            <td>{z.total}</td>
                                            <td style={{ fontWeight: 700, color: z.percent === 100 ? '#16a34a' : '#1a1f2e' }}>
                                                {z.percent}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Who has been called */}
                <div className="report-section">
                    <h3>✅ Completed ({report.completed.length})</h3>
                    {report.completed.length === 0 ? (
                        <p className="no-data">No calls completed yet.</p>
                    ) : (
                        Object.entries(completedByZone).map(([zone, people]) => (
                            <div key={zone} style={{ marginBottom: 14 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, color: '#4A90E2', margin: '10px 0 4px' }}>
                                    {zone} ({people.length})
                                </div>
                                {people.map((c, idx) => (
                                    <div key={idx} className="pending-item">
                                        <div className="pending-name">
                                            {STATUS_ICONS[c.callStatus] || '•'} {c.name}
                                        </div>
                                        <div className="pending-meta">
                                            {c.unit}{c.mobile ? ` · ${c.mobile}` : ''} · {labelByStatus[c.callStatus] || c.callStatus}
                                            {canSeeAllMentors && c.mentor ? ` · 👤 ${c.mentorName || c.mentor}` : ''}
                                        </div>
                                        {c.callRemarks && (
                                            <div className="pending-meta" style={{ fontStyle: 'italic', marginTop: 2 }}>
                                                “{c.callRemarks}”
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>

                {/* Who is left */}
                <div className="report-section">
                    <h3>⏳ Remaining ({report.pending.length})</h3>
                    {report.pending.length === 0 ? (
                        <p className="no-data">🎉 All calls completed!</p>
                    ) : (
                        Object.entries(pendingByZone).map(([zone, people]) => (
                            <div key={zone} style={{ marginBottom: 14 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, color: '#4A90E2', margin: '10px 0 4px' }}>
                                    {zone} ({people.length})
                                </div>
                                {people.map((p, idx) => (
                                    <div key={idx} className="pending-item">
                                        <div className="pending-name">{p.name}</div>
                                        <div className="pending-meta">
                                            {p.unit}{p.mobile ? ` · ${p.mobile}` : ''}{canSeeAllMentors && p.mentor ? ` · 👤 ${p.mentorName || p.mentor}` : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            </main>
        </div>
    );
}
