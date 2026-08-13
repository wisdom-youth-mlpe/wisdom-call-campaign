import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './CampaignPage.css';

interface Zone {
    name: string;
    units: string[];
}

interface CheckinReport {
    overall: { total: number; present: number; percent: number; peaceRadioCount: number; zameelCount: number };
    byZone: { zone: string; present: number; total: number; percent: number }[];
    byUnit: { zone: string; unit: string; present: number; total: number; percent: number }[];
}

function buildCheckinMessage(report: CheckinReport, zoneLabel?: string): string {
    let msg = `🧾 Check-in Report${zoneLabel ? ` — ${zoneLabel}` : ''}\n\n`;
    msg += `Total: ${report.overall.total}\n`;
    msg += `✅ Present: ${report.overall.present} (${report.overall.percent}%)\n`;
    msg += `📻 Peace Radio: ${report.overall.peaceRadioCount}\n`;
    msg += `📱 Zameel: ${report.overall.zameelCount}\n`;
    if (report.byZone.length > 1) {
        msg += `\nZone-wise:\n`;
        report.byZone.forEach(z => {
            msg += `${z.zone}: ${z.present}/${z.total} (${z.percent}%)\n`;
        });
    }
    return msg;
}

export default function CheckinReportPage() {
    const { token, logout, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [report, setReport] = useState<CheckinReport | null>(null);
    const [zones, setZones] = useState<Zone[]>([]);
    const [selectedZone, setSelectedZone] = useState<string>('all');
    const [selectedUnit, setSelectedUnit] = useState<string>('all');
    const [loading, setLoading] = useState(true);

    const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    useEffect(() => {
        if (isLoading) return;
        if (!token) {
            navigate('/login');
            return;
        }
        if (user?.role !== 'super-admin') {
            navigate('/');
        }
    }, [isLoading, token, user, navigate]);

    useEffect(() => {
        if (isLoading || !token || user?.role !== 'super-admin') return;
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
    }, [isLoading, token, user, backendUrl]);

    useEffect(() => {
        if (isLoading || !token || user?.role !== 'super-admin') return;
        const fetchReport = async () => {
            try {
                const url = `${backendUrl}/api/checkin/report?zone=${encodeURIComponent(selectedZone)}&unit=${encodeURIComponent(selectedUnit)}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Failed to fetch checkin report');
                setReport(await response.json());
            } catch (error) {
                console.error('Error fetching checkin report:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchReport();
    }, [isLoading, token, user, selectedZone, selectedUnit, backendUrl]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (isLoading || loading || user?.role !== 'super-admin') {
        return <div className="campaign-loading">Loading check-in report...</div>;
    }

    if (!report) {
        return <div className="campaign-loading">Failed to load check-in report.</div>;
    }

    const unitOptions = selectedZone === 'all'
        ? []
        : (zones.find(z => z.name === selectedZone)?.units || []);

    return (
        <div className="campaign-page">
            <header className="campaign-header">
                <h1>📊 Check-in Report</h1>
                <div className="campaign-header-actions">
                    <button className="header-btn" onClick={() => navigate('/checkin')} title="Check-in">
                        🧾
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
                <div className="filters-card">
                    <div className="filter-group">
                        <label htmlFor="checkin-report-zone-select">Zone:</label>
                        <select
                            id="checkin-report-zone-select"
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
                            <label htmlFor="checkin-report-unit-select">Unit:</label>
                            <select
                                id="checkin-report-unit-select"
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

                <div className="report-section">
                    <h3>
                        Overall Attendance
                        {selectedZone !== 'all' ? ` — ${selectedZone}${selectedUnit !== 'all' ? ` / ${selectedUnit}` : ''}` : ''}
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
                            <div className="stat-tile-value">{report.overall.present}</div>
                            <div className="stat-tile-label">Present</div>
                        </div>
                        <div className="stat-tile stat-tile--warning">
                            <div className="stat-tile-value">{report.overall.total - report.overall.present}</div>
                            <div className="stat-tile-label">Absent</div>
                        </div>
                    </div>

                    <div className="stat-tile-grid">
                        <div className="stat-tile stat-tile--neutral">
                            <div className="stat-tile-value">{report.overall.peaceRadioCount}</div>
                            <div className="stat-tile-label">Peace Radio Installed</div>
                        </div>
                        <div className="stat-tile stat-tile--neutral">
                            <div className="stat-tile-value">{report.overall.zameelCount}</div>
                            <div className="stat-tile-label">Zameel Installed</div>
                        </div>
                    </div>

                    <button
                        onClick={async () => {
                            try {
                                const zoneLabel = selectedZone !== 'all' ? `${selectedZone}${selectedUnit !== 'all' ? ` / ${selectedUnit}` : ''}` : undefined;
                                await navigator.clipboard.writeText(buildCheckinMessage(report, zoneLabel));
                                alert('Check-in update copied to clipboard!');
                            } catch {
                                alert('Failed to copy. Please copy manually.');
                            }
                        }}
                        className="template-btn"
                        style={{ background: '#25D366', color: 'white', border: 'none', marginTop: 16, width: '100%', boxShadow: '0 3px 10px rgba(37,211,102,0.3)' }}
                    >
                        📋 Copy WhatsApp Update
                    </button>
                </div>

                {report.byZone.length > 0 && (
                    <div className="report-section">
                        <h3>📍 By Zone</h3>
                        <div className="report-table-wrap">
                            <table className="report-table">
                                <thead>
                                    <tr>
                                        <th>Zone</th>
                                        <th>Present</th>
                                        <th>Total</th>
                                        <th>%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byZone.map(z => (
                                        <tr key={z.zone}>
                                            <td>{z.zone}</td>
                                            <td>{z.present}</td>
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

                {report.byUnit.length > 0 && (
                    <div className="report-section">
                        <h3>🏘️ By Unit</h3>
                        <div className="report-table-wrap">
                            <table className="report-table">
                                <thead>
                                    <tr>
                                        <th>Zone</th>
                                        <th>Unit</th>
                                        <th>Present</th>
                                        <th>Total</th>
                                        <th>%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byUnit.map(u => (
                                        <tr key={`${u.zone}|${u.unit}`}>
                                            <td>{u.zone}</td>
                                            <td>{u.unit}</td>
                                            <td>{u.present}</td>
                                            <td>{u.total}</td>
                                            <td style={{ fontWeight: 700, color: u.percent === 100 ? '#16a34a' : '#1a1f2e' }}>
                                                {u.percent}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
