import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './CampaignPage.css';

interface GroupStat {
    total: number;
    called: number;
    percent: number;
}

interface Report {
    overall: { total: number; called: number; remaining: number; percent: number };
    byZone: (GroupStat & { zone: string })[];
    byMentor?: (GroupStat & { mentor: string })[];
    pending: { zone: string; unit: string; name: string; mobile: string; mentor: string }[];
}

export default function ReportPage() {
    const { token, logout, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [report, setReport] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);

    const isSuperAdmin = user?.role === 'super-admin';
    const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    useEffect(() => {
        if (isLoading) return;
        if (!token) {
            navigate('/login');
            return;
        }
        const fetchReport = async () => {
            try {
                const response = await fetch(`${backendUrl}/api/report`, {
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
    }, [token, navigate, isLoading]);

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

    // Group pending people by zone for readability
    const pendingByZone: Record<string, Report['pending']> = {};
    report.pending.forEach(p => {
        const key = p.zone || 'Unknown';
        if (!pendingByZone[key]) pendingByZone[key] = [];
        pendingByZone[key].push(p);
    });

    return (
        <div className="campaign-page">
            <header className="campaign-header">
                <h1>📊 Report</h1>
                <div className="campaign-header-actions">
                    <button className="header-btn" onClick={() => navigate('/')} title="Call Campaign">
                        📞
                    </button>
                    <button className="header-btn" onClick={handleLogout} title="Logout">
                        ⏻
                    </button>
                </div>
            </header>

            <main className="campaign-content">
                {/* Overall progress */}
                <div className="report-section">
                    <h3>Overall Progress{!isSuperAdmin && user ? ` — ${user.username}` : ''}</h3>
                    <div className="report-big-percent">{report.overall.percent}%</div>
                    <div className="report-sub">
                        {report.overall.called} of {report.overall.total} called · {report.overall.remaining} remaining
                    </div>
                    <div className="progress-track" style={{ marginTop: 12 }}>
                        <div className="progress-fill" style={{ width: `${report.overall.percent}%` }} />
                    </div>
                </div>

                {/* Per-mentor breakdown (super-admin only) */}
                {isSuperAdmin && report.byMentor && report.byMentor.length > 0 && (
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
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byMentor.map(m => (
                                        <tr key={m.mentor}>
                                            <td>{m.mentor}</td>
                                            <td>{m.called}</td>
                                            <td>{m.total}</td>
                                            <td style={{ fontWeight: 700, color: m.percent === 100 ? '#16a34a' : '#1a1f2e' }}>
                                                {m.percent}%
                                            </td>
                                        </tr>
                                    ))}
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
                                            {p.unit}{p.mobile ? ` · ${p.mobile}` : ''}{isSuperAdmin && p.mentor ? ` · 👤 ${p.mentor}` : ''}
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
