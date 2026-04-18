import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getUsers, createUser, updateUser, deleteUser, getCurrentUser } from '../../api/auth';
import { getAllLogs, getLogsByUser } from '../../api/logs';
import Navbar from '../../components/shared/Navbar';
import { captureAllCharts, exportToPDF } from '../../components/admin/ExportToPdf';
import { exportToExcel } from '../../components/admin/ExportToExcel';
import '../../styles/DashboardAdmin.css';
import { Pie, Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(ArcElement, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

interface User {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
}

interface Log {
  log_id: number;
  user_id: number;
  action: string;
  timestamp: string;
}

interface Notification {
  show: boolean;
  message: string;
  type: 'success' | 'error' | 'warning' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
}

type ChartType = 'role' | 'overview' | 'peak' | 'action' | 'trend' | 'summary';

const CHARTS: ChartType[] = ['role', 'overview', 'peak', 'action', 'trend', 'summary'];

const CHART_LABELS: Record<ChartType, string> = {
  role: 'Team Composition',
  overview: 'Activity Overview',
  peak: 'Peak Performance',
  action: 'Action Analytics',
  trend: 'Trend Analysis',
  summary: 'Executive Summary',
};

const ROLE_ORDER = ['admin', 'staff', 'doctor'];

function getLogAvatarClass(action: string): string {
  const a = action.toUpperCase();
  if (a.includes('CREATE')) return 'log-avatar-create';
  if (a.includes('UPDATE') || a.includes('EDIT')) return 'log-avatar-edit';
  if (a.includes('DELETE')) return 'log-avatar-delete';
  if (a.includes('LOGIN_FAILED') || a.includes('ERROR')) return 'log-avatar-error';
  if (a.includes('LOGIN')) return 'log-avatar-login';
  return 'log-avatar-default';
}

function getLogAvatarLetter(action: string): string {
  const a = action.toUpperCase();
  if (a.includes('CREATE')) return 'C';
  if (a.includes('UPDATE')) return 'U';
  if (a.includes('EDIT')) return 'E';
  if (a.includes('DELETE')) return 'D';
  if (a.includes('LOGIN_FAILED')) return '!';
  if (a.includes('LOGIN')) return 'L';
  if (a.includes('GET')) return 'G';
  if (a.includes('ERROR')) return '!';
  return action.charAt(0).toUpperCase();
}

const DashboardAdmin = () => {
  const currentUser = getCurrentUser();

  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [createFormData, setCreateFormData] = useState({ username: '', password: '', full_name: '', role: 'staff' });
  const [editFormData, setEditFormData] = useState({ full_name: '', username: '', role: '' });
  const [newPassword, setNewPassword] = useState('');

  const [allLogs, setAllLogs] = useState<Log[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [dateFilter, setDateFilter] = useState('');
  const [filteredLogs, setFilteredLogs] = useState<Log[]>([]);
  const [isHoveringLogs, setIsHoveringLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const [notification, setNotification] = useState<Notification>({ show: false, message: '', type: 'success' });
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chartIndex, setChartIndex] = useState(0);
  const [chartAnimDir, setChartAnimDir] = useState<'right' | 'left'>('right');
  const [chartVisible, setChartVisible] = useState(true);
  const autoSlideRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const pieChartRef = useRef<HTMLDivElement>(null);
  const barChartRef = useRef<HTMLDivElement>(null);
  const lineChartRef = useRef<HTMLDivElement>(null);
  const userListRef = useRef<HTMLDivElement>(null);

  const sortedUsers = [...users].sort((a, b) => {
    return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
  });

  const filterLogs = useCallback(() => {
    const base = selectedUser ? logs : allLogs;
    if (!dateFilter) {
      setFilteredLogs(base);
    } else {
      setFilteredLogs(base.filter(log => log.timestamp.startsWith(dateFilter)));
    }
  }, [logs, allLogs, dateFilter, selectedUser]);

  useEffect(() => { loadUsers(); loadAllLogs(); }, []);

  useEffect(() => {
    if (selectedUser && !isCreating) {
      loadLogs(selectedUser.user_id);
      setEditFormData({ full_name: selectedUser.full_name, username: selectedUser.username, role: selectedUser.role });
    } else if (!isCreating) {
      setLogs([]);
    }
  }, [selectedUser, isCreating]);

  useEffect(() => { filterLogs(); }, [filterLogs]);

  useEffect(() => {
    if (notification.show && notification.type !== 'confirm') {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      autoCloseRef.current = setTimeout(() => setNotification(p => ({ ...p, show: false })), 3000);
      return () => { if (autoCloseRef.current) clearTimeout(autoCloseRef.current); };
    }
  }, [notification.show, notification.type]);

  useEffect(() => {
    autoSlideRef.current = setInterval(() => { navigateChart('right', true); }, 10000);
    return () => { if (autoSlideRef.current) clearInterval(autoSlideRef.current); };
  }, [chartIndex]);

  useEffect(() => {
    if (!isHoveringLogs && filteredLogs.length > 0 && logsContainerRef.current) {
      let accumulatedScroll = 0;
      const smoothScroll = () => {
        if (!logsContainerRef.current || isHoveringLogs) return;
        const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
        const maxScroll = scrollHeight - clientHeight;
        accumulatedScroll += 0.5;
        if (accumulatedScroll >= 1) {
          const pixels = Math.floor(accumulatedScroll);
          accumulatedScroll -= pixels;
          logsContainerRef.current.scrollTop = scrollTop + pixels >= maxScroll ? 0 : scrollTop + pixels;
        }
      };
      const scrollInterval = setInterval(smoothScroll, 16);
      return () => clearInterval(scrollInterval);
    }
  }, [isHoveringLogs, filteredLogs]);

  const navigateChart = (dir: 'right' | 'left', auto = false) => {
    if (!auto && autoSlideRef.current) clearInterval(autoSlideRef.current);
    setChartVisible(false);
    setChartAnimDir(dir);
    setTimeout(() => {
      setChartIndex(prev => dir === 'right' ? (prev + 1) % CHARTS.length : (prev - 1 + CHARTS.length) % CHARTS.length);
      setChartVisible(true);
    }, 200);
  };

  const handleUserListWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (userListRef.current) {
      e.preventDefault();
      userListRef.current.scrollLeft += e.deltaY > 0 ? 120 : -120;
    }
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'warning') => {
    setNotification({ show: true, message, type });
  };

  const showConfirmDelete = (user: User, onConfirm: () => void) => {
    setNotification({
      show: true,
      message: `Remove ${user.full_name}?`,
      type: 'confirm',
      onConfirm: () => { setNotification({ show: false, message: '', type: 'success' }); onConfirm(); },
      onCancel: () => { setNotification({ show: false, message: '', type: 'success' }); }
    });
  };

  const loadUsers = async () => {
    try { const data = await getUsers(); setUsers(data); }
    catch (err) { console.error('Failed to load users:', err); }
  };

  const loadAllLogs = async () => {
    try {
      const data: Log[] = await getAllLogs({ limit: 500 });
      setAllLogs(data);
    } catch (err) { console.error('Failed to load logs:', err); }
  };

  const loadLogs = async (userId: number) => {
    try { const data = await getLogsByUser(userId); setLogs(data); }
    catch { setLogs([]); }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createUser(createFormData.username, createFormData.password, createFormData.full_name, createFormData.role);
      showNotification('User created', 'success');
      setIsCreating(false);
      setCreateFormData({ username: '', password: '', full_name: '', role: 'staff' });
      loadUsers(); loadAllLogs();
    } catch (err) { console.error(err); showNotification('Failed to create user', 'error'); }
  };

  const handleSaveEdit = async () => {
    if (!selectedUser) return;
    try {
      await updateUser(selectedUser.user_id, editFormData.username, editFormData.full_name, editFormData.role);
      showNotification('User updated', 'success');
      setIsEditing(false);
      loadUsers(); loadAllLogs();
      setSelectedUser({ ...selectedUser, full_name: editFormData.full_name, username: editFormData.username, role: editFormData.role });
    } catch (err) { console.error(err); showNotification('Failed to update user', 'error'); }
  };

  const handlePasswordChange = async () => {
    if (!selectedUser || !newPassword) return;
    try {
      await updateUser(selectedUser.user_id, selectedUser.username, selectedUser.full_name, selectedUser.role, newPassword);
      showNotification('Password updated', 'success');
      setIsChangingPassword(false);
      setNewPassword('');
    } catch (err) { console.error(err); showNotification('Failed to update password', 'error'); }
  };

  const handleDeleteUser = async (user: User) => {
    try {
      await deleteUser(user.user_id);
      showNotification('User deleted', 'success');
      if (selectedUser?.user_id === user.user_id) setSelectedUser(null);
      loadUsers(); loadAllLogs();
    } catch (err) { console.error(err); showNotification('Failed to delete user', 'error'); }
  };

  const handleSelectUser = (user: User) => {
    if (selectedUser?.user_id === user.user_id) {
      setSelectedUser(null); setIsEditing(false); setIsCreating(false); setIsChangingPassword(false);
    } else {
      setSelectedUser(user); setIsEditing(false); setIsCreating(false); setIsChangingPassword(false); setNewPassword('');
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setCreateFormData({ username: '', password: '', full_name: '', role: 'staff' });
  };

  const handleCancelPasswordChange = () => { setIsChangingPassword(false); setNewPassword(''); };

  const handleExportToPDF = async () => {
    showNotification('Generating report...', 'warning');
    const chartImages = await captureAllCharts(pieChartRef, barChartRef, lineChartRef);
    await exportToPDF(
      users, allLogs, selectedUser, dateFilter, roleCounts, activityByUser, activityByDay,
      getCurrentMonthStats, getCurrentMonthLogs, generateInsights, chartImages, showNotification
    );
  };

  const handleExportToExcel = () => {
    if (filteredLogs.length === 0) {
      showNotification('No logs to export', 'warning');
      return;
    }
    exportToExcel(filteredLogs, users, dateFilter, selectedUser, showNotification);
  };

  const getRoleDistribution = () => {
    const counts = { admin: 0, staff: 0, doctor: 0 };
    users.forEach(u => { if (u.role in counts) counts[u.role as keyof typeof counts]++; });
    return counts;
  };

  const getActivityByDay = () => {
    const base = selectedUser ? logs : allLogs;
    const map: Record<string, number> = {};
    base.forEach(log => { const d = log.timestamp.split('T')[0]; map[d] = (map[d] || 0) + 1; });
    const sorted = Object.keys(map).sort().slice(-7);
    return { labels: sorted, data: sorted.map(d => map[d]) };
  };

  const getActivityByUser = () => {
    const map: Record<number, number> = {};
    allLogs.forEach(log => { map[log.user_id] = (map[log.user_id] || 0) + 1; });
    const sorted = users.map(u => ({ name: u.full_name, count: map[u.user_id] || 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 5);
    return { labels: sorted.map(u => u.name), data: sorted.map(u => u.count) };
  };

  const getCurrentMonthStats = () => {
    const now = new Date();
    const monthLogs = allLogs.filter(log => {
      const d = new Date(log.timestamp);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const actionCounts: Record<string, number> = {};
    monthLogs.forEach(log => { actionCounts[log.action] = (actionCounts[log.action] || 0) + 1; });
    return {
      total: monthLogs.length,
      topActions: Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
      uniqueUsers: new Set(monthLogs.map(l => l.user_id)).size,
    };
  };

  const getCurrentMonthLogs = () => {
    const now = new Date();
    return allLogs.filter(log => {
      const d = new Date(log.timestamp);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  };

  const generateInsights = (): string[] => {
    const insights: string[] = [];
    const monthStats = getCurrentMonthStats();
    const monthLogs = getCurrentMonthLogs();

    if (monthLogs.length > 0) {
      insights.push(`Average daily activity this month: ${(monthLogs.length / new Date().getDate()).toFixed(1)} actions/day.`);
    } else {
      insights.push('No activity recorded this month.');
    }

    const roleCountsLocal = getRoleDistribution();
    const dominantRole = Object.entries(roleCountsLocal).sort((a, b) => b[1] - a[1])[0];
    if (dominantRole) {
      const roleLabel = dominantRole[0] === 'admin' ? 'Administrator' : dominantRole[0] === 'doctor' ? 'Doctor' : 'Medical Staff';
      insights.push(`Most common role: ${roleLabel} (${((dominantRole[1] / users.length) * 100).toFixed(0)}% of total users).`);
    }

    const activity = getActivityByUser();
    if (activity.labels.length > 0) {
      insights.push(`Most active user: ${activity.labels[0]} with ${activity.data[0]} recorded activities.`);
    }

    if (monthStats.topActions.length > 0) {
      const [topAction, topCount] = monthStats.topActions[0];
      insights.push(`Most common action this month: "${topAction}" (${monthStats.total > 0 ? ((topCount / monthStats.total) * 100).toFixed(0) : 0}% of all activities).`);
    }

    const failedLogins = allLogs.filter(l => l.action.toUpperCase().includes('LOGIN_FAILED') || l.action.toUpperCase().includes('LOGIN FAILED'));
    if (failedLogins.length > 0) {
      insights.push(`[WARNING] Detected ${failedLogins.length} failed login attempts. Please investigate.`);
    }

    const activeUserIds = new Set(allLogs.map(l => l.user_id));
    const inactiveUsers = users.filter(u => !activeUserIds.has(u.user_id));
    if (inactiveUsers.length > 0) {
      insights.push(`${inactiveUsers.length} users have no recorded activity.`);
    }

    if (users.length > 0 && allLogs.length === 0) {
      insights.push('Recommendation: Verify logging system is working properly.');
    } else if (monthStats.total === 0 && allLogs.length > 0) {
      insights.push('Recommendation: No activity this month. Verify active user access.');
    } else {
      insights.push('System operating normally. Review logs periodically each month.');
    }

    return insights;
  };

  const getPeakPerformance = () => {
    const base = selectedUser ? logs : allLogs;
    const hours = Array(24).fill(0);
    base.forEach(log => { hours[new Date(log.timestamp).getHours()]++; });
    const peakHour = hours.indexOf(Math.max(...hours));
    const peakHourCount = hours[peakHour];

    const userActivity: Record<number, { name: string; count: number; role: string }> = {};
    base.forEach(log => {
      const user = users.find(u => u.user_id === log.user_id);
      if (user) {
        if (!userActivity[log.user_id]) userActivity[log.user_id] = { name: user.full_name, count: 0, role: user.role };
        userActivity[log.user_id].count++;
      }
    });
    const topUsers = Object.values(userActivity).sort((a, b) => b.count - a.count).slice(0, 3);
    return { peakHour, peakHourCount, topUsers, totalActivities: base.length };
  };

  const getActionAnalytics = () => {
    const base = selectedUser ? logs : allLogs;
    const actions: Record<string, number> = { CREATE: 0, UPDATE: 0, DELETE: 0, LOGIN: 0, GET: 0, OTHER: 0 };
    base.forEach(log => {
      const a = log.action.toUpperCase();
      if (a.includes('CREATE')) actions['CREATE']++;
      else if (a.includes('UPDATE')) actions['UPDATE']++;
      else if (a.includes('DELETE')) actions['DELETE']++;
      else if (a.includes('LOGIN')) actions['LOGIN']++;
      else if (a.includes('GET')) actions['GET']++;
      else actions['OTHER']++;
    });
    const filtered = Object.entries(actions).filter(([_, v]) => v > 0);
    return { labels: filtered.map(([k]) => k), data: filtered.map(([_, v]) => v) };
  };

  const getTrendAnalysis = () => {
    const daily = getActivityByDay();
    const total = daily.data.reduce((a, b) => a + b, 0);
    const avg = total / (daily.data.length || 1);
    const peak = Math.max(...(daily.data.length ? daily.data : [0]));
    const trend = daily.data.length > 1 ? daily.data[daily.data.length - 1] - daily.data[0] : 0;
    const trendDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable';
    const trendPercent = daily.data[0] > 0 ? ((trend / daily.data[0]) * 100).toFixed(1) : '0';
    return { daily, total, avg: avg.toFixed(1), peak, trend, trendDirection, trendPercent };
  };

  const getExecutiveSummaryData = () => {
    const base = selectedUser ? logs : allLogs;
    const totalActivities = base.length;
    const uniqueUsers = new Set(base.map(l => l.user_id)).size;
    const successRate = base.filter(l => !l.action.includes('FAILED')).length / (totalActivities || 1) * 100;
    const peakData = getPeakPerformance();
    const trendData = getTrendAnalysis();

    let status = 'Healthy';
    let statusColor = '#22c55e';
    let mainRecommendation = '';

    if (trendData.trendDirection === 'down' && Math.abs(trendData.trend) > 5) {
      status = 'Declining'; statusColor = '#ef4444';
      mainRecommendation = 'Activity decreasing — investigate team engagement';
    } else if (successRate < 80) {
      status = 'Needs Attention'; statusColor = '#f59e0b';
      mainRecommendation = 'High error rate — check system logs';
    } else if (totalActivities < 10) {
      status = 'Inactive'; statusColor = '#ef4444';
      mainRecommendation = 'Low activity — encourage system usage';
    } else {
      mainRecommendation = 'Maintain current momentum';
    }

    return {
      totalActivities, uniqueUsers, successRate: successRate.toFixed(1),
      status, statusColor, mainRecommendation,
      peakHour: peakData.peakHour === 0 ? 'Midnight' : `${peakData.peakHour}:00`,
      topUser: peakData.topUsers[0]?.name || 'None',
      trendDirection: trendData.trendDirection,
    };
  };

  const roleCounts = getRoleDistribution();
  const activityByDay = getActivityByDay();
  const activityByUser = getActivityByUser();

  const chartOption = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const, labels: { font: { size: 10, family: 'DM Sans' }, boxWidth: 8, padding: 8 } } },
    scales: undefined as any,
  };

  const barLineOption = {
    ...chartOption,
    scales: {
      x: { ticks: { font: { size: 9, family: 'DM Sans' } }, grid: { display: false } },
      y: { ticks: { font: { size: 9, family: 'DM Sans' } }, grid: { color: '#f0f2f7' } },
    },
  };

  const pieData = {
    labels: ['Admin', 'Doctor', 'Staff'],
    datasets: [{ data: [roleCounts.admin, roleCounts.doctor, roleCounts.staff], backgroundColor: ['#ef4444', '#22c55e', '#f59e0b'], borderWidth: 2, borderColor: '#fff' }],
  };

  const barData = {
    labels: activityByUser.labels,
    datasets: [{ label: 'Activities', data: activityByUser.data, backgroundColor: '#4f7ef8', borderRadius: 5 }],
  };

  const lineData = {
    labels: activityByDay.labels,
    datasets: [{ label: 'Daily Activity', data: activityByDay.data, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', tension: 0.4, fill: true, pointRadius: 3 }],
  };

  const currentChart = CHARTS[chartIndex];

  const getRoleIconUrl = (role: string) => {
    switch (role) {
      case 'admin': return 'http://localhost:8000/static/admin.png';
      case 'doctor': return 'http://localhost:8000/static/dokter.png';
      case 'staff': return 'http://localhost:8000/static/staff.png';
      default: return '';
    }
  };

  const getRoleAccent = (role: string) => {
    switch (role) {
      case 'admin': return { bg: 'var(--role-admin-bg)', border: 'var(--role-admin-border)', badge: 'var(--role-admin-badge)', label: 'Administrator', icon: '🔐' };
      case 'doctor': return { bg: 'var(--role-doctor-bg)', border: 'var(--role-doctor-border)', badge: 'var(--role-doctor-badge)', label: 'Doctor', icon: '🩺' };
      case 'staff': return { bg: 'var(--role-staff-bg)', border: 'var(--role-staff-border)', badge: 'var(--role-staff-badge)', label: 'Medical Staff', icon: '🏥' };
      default: return { bg: 'var(--surface-2)', border: 'var(--border)', badge: 'var(--text-muted)', label: role, icon: '👤' };
    }
  };

  return (
    <div className="dashboard-wrapper">
      <Navbar userFullName={currentUser?.full_name} userRole={currentUser?.role} />

      {notification.show && (
        <div className={`notification notification-${notification.type}`}>
          {notification.type === 'confirm' ? (
            <>
              <span className="confirm-icon-simple">⚠️</span>
              <span className="confirm-message">{notification.message}</span>
              <div className="confirm-actions-simple">
                <button className="confirm-no-simple" onClick={() => notification.onCancel?.()}>No</button>
                <button className="confirm-yes-simple" onClick={() => notification.onConfirm?.()}>Yes</button>
              </div>
            </>
          ) : (
            <>
              <span className="notification-icon">
                {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : '⚠'}
              </span>
              <span className="notification-message">{notification.message}</span>
            </>
          )}
        </div>
      )}

      <main className="main-container">
        <div className="dashboard-layout">

          <section className="card user-details-card">
            <div className="card-header">
              <h3>{isCreating ? 'New Staff' : 'Staff Details'}</h3>
            </div>

            {isCreating ? (
              <form onSubmit={handleCreateUser} className="detail-content create-form">
                <div className="detail-form">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input type="text" value={createFormData.full_name} onChange={e => setCreateFormData({ ...createFormData, full_name: e.target.value })} placeholder="Enter full name" required autoFocus />
                  </div>
                  <div className="form-group">
                    <label>Username</label>
                    <input type="text" value={createFormData.username} onChange={e => setCreateFormData({ ...createFormData, username: e.target.value })} placeholder="Enter username" required />
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <input type="password" value={createFormData.password} onChange={e => setCreateFormData({ ...createFormData, password: e.target.value })} placeholder="Enter password" required />
                  </div>
                  <div className="form-group">
                    <label>Role</label>
                    <select value={createFormData.role} onChange={e => setCreateFormData({ ...createFormData, role: e.target.value })}>
                      <option value="admin">Administrator</option>
                      <option value="doctor">Doctor</option>
                      <option value="staff">Medical Staff</option>
                    </select>
                  </div>
                  <div className="form-actions-row">
                    <button type="submit" className="btn-submit btn-create">+ Create</button>
                    <button type="button" onClick={handleCancelCreate} className="btn-cancel-form">Cancel</button>
                  </div>
                </div>
              </form>
            ) : !selectedUser ? (
              <div className="empty-state"><div className="empty-icon">👤</div><p>Select a staff to view details</p></div>
            ) : (
              <div className="detail-content">
                <div className="detail-avatar-section">
                  <div className="detail-avatar-wrapper">
                    <img
                      src={getRoleIconUrl(selectedUser.role)}
                      alt={selectedUser.role}
                      className="detail-avatar-img"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          parent.textContent = selectedUser.full_name.charAt(0).toUpperCase();
                          parent.style.background = selectedUser.role === 'admin' ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                            : selectedUser.role === 'doctor' ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                            : 'linear-gradient(135deg, #f59e0b, #d97706)';
                          parent.style.display = 'flex';
                          parent.style.alignItems = 'center';
                          parent.style.justifyContent = 'center';
                          parent.style.color = 'white';
                          parent.style.fontWeight = '700';
                          parent.style.fontSize = '32px';
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="detail-form compact">
                  <div className="form-group compact">
                    <label>Full Name</label>
                    <input type="text" value={editFormData.full_name} onChange={e => setEditFormData({ ...editFormData, full_name: e.target.value })} disabled={!isEditing} />
                  </div>
                  <div className="form-group compact">
                    <label>Username</label>
                    <input type="text" value={editFormData.username} onChange={e => setEditFormData({ ...editFormData, username: e.target.value })} disabled={!isEditing} />
                  </div>
                  <div className="form-group compact">
                    <label>Role</label>
                    <select value={editFormData.role} onChange={e => setEditFormData({ ...editFormData, role: e.target.value })} disabled={!isEditing}>
                      <option value="admin">Administrator</option>
                      <option value="doctor">Doctor</option>
                      <option value="staff">Medical Staff</option>
                    </select>
                  </div>
                  <div className="form-group compact password-change-section">
                    <label>Password</label>
                    {!isChangingPassword ? (
                      <button type="button" className="btn-change-password-full" onClick={() => setIsChangingPassword(true)}>
                        Change Password
                      </button>
                    ) : (
                      <div className="password-change-form">
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Enter new password" className="password-change-input" autoFocus />
                        <div className="password-change-actions">
                          <button type="button" className="btn-save-password" onClick={handlePasswordChange}>Save</button>
                          <button type="button" className="btn-cancel-password" onClick={handleCancelPasswordChange}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="card statistics-card">
            <div className="card-header-no-border">
              <div className="statistics-header-left">
                <h3>Statistics</h3>
              </div>
              <div className="statistics-controls">
                <div className="nav-group">
                  <button className="stat-nav-btn" onClick={() => navigateChart('left')} title="Previous">‹</button>
                  <div className="stat-indicators">
                    {CHARTS.map((c, i) => (
                      <button
                        key={i}
                        className={`stat-dot ${i === chartIndex ? 'active' : ''}`}
                        title={CHART_LABELS[c]}
                        onClick={() => {
                          if (autoSlideRef.current) clearInterval(autoSlideRef.current);
                          setChartVisible(false);
                          setTimeout(() => { setChartIndex(i); setChartVisible(true); }, 200);
                        }}
                      />
                    ))}
                  </div>
                  <button className="stat-nav-btn" onClick={() => navigateChart('right')} title="Next">›</button>
                </div>
                <button onClick={handleExportToPDF} className="btn-stat-export" title="Export PDF">
                  <span>↓</span> PDF
                </button>
              </div>
            </div>

            <div className="stat-progress-track">
              <div className="stat-progress-fill" style={{ width: `${((chartIndex + 1) / CHARTS.length) * 100}%` }} />
            </div>

            <div className="stat-meta-row">
              <span className="stat-viewing-subtitle">
                {selectedUser ? `Viewing: ${selectedUser.full_name}` : 'All Users'}
              </span>
              <span className="stat-slide-label">{CHART_LABELS[currentChart]}</span>
            </div>

            <div className="chart-wrapper" ref={chartContainerRef}>
              <div className={`chart-slide ${chartVisible
                ? (chartAnimDir === 'right' ? 'chart-slide-enter' : 'chart-slide-enter-left')
                : (chartAnimDir === 'right' ? 'chart-slide-exit' : 'chart-slide-exit-right')}`}
              >
                <div className="chart-inner">

                  <div ref={pieChartRef} style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                    <div style={{ width: '400px', padding: '20px', background: 'white' }}>
                      <p style={{ textAlign: 'center', marginBottom: '10px', fontFamily: 'DM Sans' }}>Team Composition</p>
                      <div style={{ height: '300px' }}><Pie data={pieData} options={chartOption} /></div>
                    </div>
                  </div>
                  <div ref={barChartRef} style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                    <div style={{ width: '500px', padding: '20px', background: 'white' }}>
                      <p style={{ textAlign: 'center', marginBottom: '10px', fontFamily: 'DM Sans' }}>Activity Overview</p>
                      <div style={{ height: '300px' }}><Bar data={barData} options={barLineOption} /></div>
                    </div>
                  </div>
                  <div ref={lineChartRef} style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                    <div style={{ width: '500px', padding: '20px', background: 'white' }}>
                      <p style={{ textAlign: 'center', marginBottom: '10px', fontFamily: 'DM Sans' }}>Trend Analysis</p>
                      <div style={{ height: '300px' }}><Line data={lineData} options={barLineOption} /></div>
                    </div>
                  </div>

                  {currentChart === 'role' && (
                    <div className="slide-layout slide-role">
                      <div className="slide-chart-area">
                        <Pie data={pieData} options={chartOption} />
                      </div>
                      <div className="slide-legend-area">
                        {[
                          { label: 'Administrator', count: roleCounts.admin, color: '#ef4444' },
                          { label: 'Doctor', count: roleCounts.doctor, color: '#22c55e' },
                          { label: 'Medical Staff', count: roleCounts.staff, color: '#f59e0b' },
                        ].map(item => (
                          <div className="role-legend-item" key={item.label}>
                            <span className="role-dot" style={{ background: item.color }} />
                            <span className="role-legend-label">{item.label}</span>
                            <span className="role-legend-count">{item.count}</span>
                            <span className="role-legend-pct">
                              {users.length > 0 ? ((item.count / users.length) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        ))}
                        <div className="role-total-row">
                          <span className="role-legend-label" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total</span>
                          <span className="role-legend-count" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{users.length}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {currentChart === 'overview' && (
                    <div className="slide-layout slide-overview">
                      <div className="kpi-strip">
                        <div className="kpi-chip kpi-blue">
                          <span className="kpi-chip-value">{activityByDay.data.reduce((a, b) => a + b, 0)}</span>
                          <span className="kpi-chip-label">7-Day Total</span>
                        </div>
                        <div className="kpi-chip kpi-purple">
                          <span className="kpi-chip-value">{(activityByDay.data.reduce((a, b) => a + b, 0) / 7).toFixed(1)}</span>
                          <span className="kpi-chip-label">Daily Avg</span>
                        </div>
                        <div className="kpi-chip kpi-green">
                          <span className="kpi-chip-value">{Math.max(...(activityByDay.data.length ? activityByDay.data : [0]))}</span>
                          <span className="kpi-chip-label">Peak Day</span>
                        </div>
                      </div>
                      <div className="slide-chart-full">
                        <Bar
                          data={{
                            labels: activityByDay.labels,
                            datasets: [{
                              label: 'Activities',
                              data: activityByDay.data,
                              backgroundColor: activityByDay.data.map(v =>
                                v === Math.max(...activityByDay.data) ? '#4f7ef8' : 'rgba(79,126,248,0.35)'
                              ),
                              borderRadius: 5,
                            }]
                          }}
                          options={{ ...barLineOption, plugins: { ...barLineOption.plugins, legend: { display: false } } }}
                        />
                      </div>
                    </div>
                  )}

                  {currentChart === 'peak' && (() => {
                    const peak = getPeakPerformance();
                    const hourLabel = peak.peakHour === 0 ? '00:00' : `${String(peak.peakHour).padStart(2, '0')}:00`;
                    return (
                      <div className="slide-layout slide-peak">
                        <div className="peak-banner">
                          <div className="peak-banner-left">
                            <span className="peak-banner-icon">⏰</span>
                            <div>
                              <span className="peak-banner-sublabel">Peak Activity Hour</span>
                              <span className="peak-banner-hour">{hourLabel}</span>
                            </div>
                          </div>
                          <div className="peak-banner-right">
                            <span className="peak-banner-count">{peak.peakHourCount}</span>
                            <span className="peak-banner-countlabel">activities</span>
                          </div>
                        </div>
                        <div className="peak-performers">
                          <span className="performers-heading">🏆 Top Performers</span>
                          <div className="performers-list">
                            {peak.topUsers.length === 0 && <span className="no-data">No data available</span>}
                            {peak.topUsers.map((user, idx) => {
                              const maxCount = peak.topUsers[0]?.count || 1;
                              const medals = ['🥇', '🥈', '🥉'];
                              const barColors = [
                                'linear-gradient(90deg,#f59e0b,#fbbf24)',
                                'linear-gradient(90deg,#9ca3af,#d1d5db)',
                                'linear-gradient(90deg,#cd7c3a,#e6a56e)',
                              ];
                              return (
                                <div key={idx} className="performer-row">
                                  <span className="performer-medal">{medals[idx]}</span>
                                  <div className="performer-bar-wrap">
                                    <div className="performer-name-line">
                                      <span className="performer-name">{user.name}</span>
                                      <span className="performer-count">{user.count} acts</span>
                                    </div>
                                    <div className="performer-bar-track">
                                      <div className="performer-bar-fill" style={{ width: `${(user.count / maxCount) * 100}%`, background: barColors[idx] }} />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {currentChart === 'action' && (() => {
                    const analytics = getActionAnalytics();
                    const total = analytics.data.reduce((a, b) => a + b, 0);
                    const colors = ['#4f7ef8', '#f59e0b', '#ef4444', '#22c55e', '#8b5cf6', '#06b6d4'];
                    return (
                      <div className="slide-layout slide-action">
                        <div className="slide-chart-area">
                          <Pie
                            data={{
                              labels: analytics.labels,
                              datasets: [{ data: analytics.data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }]
                            }}
                            options={chartOption}
                          />
                        </div>
                        <div className="slide-legend-area">
                          <span className="action-breakdown-title">Action Breakdown</span>
                          {analytics.labels.map((label, i) => (
                            <div className="action-row" key={label}>
                              <span className="action-dot" style={{ background: colors[i % colors.length] }} />
                              <span className="action-label">{label}</span>
                              <div className="action-bar-mini">
                                <div className="action-bar-fill-mini" style={{ width: `${total > 0 ? (analytics.data[i] / total) * 100 : 0}%`, background: colors[i % colors.length] }} />
                              </div>
                              <span className="action-count">{analytics.data[i]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {currentChart === 'trend' && (() => {
                    const trend = getTrendAnalysis();
                    const trendColor = trend.trendDirection === 'up' ? '#22c55e' : trend.trendDirection === 'down' ? '#ef4444' : '#f59e0b';
                    const trendArrow = trend.trendDirection === 'up' ? '▲' : trend.trendDirection === 'down' ? '▼' : '●';
                    return (
                      <div className="slide-layout slide-trend">
                        <div className="trend-stats-strip">
                          <div className="trend-stat-chip trend-chip-change" style={{ borderColor: trendColor, borderWidth: 2 }}>
                            <span className="trend-stat-arrow" style={{ color: trendColor }}>{trendArrow}</span>
                            <span className="trend-stat-pct" style={{ color: trendColor }}>
                              {trend.trendDirection === 'up' ? '+' : ''}{trend.trendPercent}%
                            </span>
                            <span className="trend-stat-sublabel">7-Day Change</span>
                          </div>
                          <div className="trend-stat-chip trend-chip-avg">
                            <span className="trend-stat-num">{trend.avg}</span>
                            <span className="trend-stat-sublabel">Avg / Day</span>
                          </div>
                          <div className="trend-stat-chip trend-chip-peak">
                            <span className="trend-stat-num">{trend.peak}</span>
                            <span className="trend-stat-sublabel">Peak Day</span>
                          </div>
                        </div>
                        <div className="slide-chart-full">
                          <Line
                            data={{
                              labels: trend.daily.labels,
                              datasets: [{
                                label: 'Daily Activity',
                                data: trend.daily.data,
                                borderColor: trendColor,
                                backgroundColor: `${trendColor}18`,
                                tension: 0.4,
                                fill: true,
                                pointRadius: 4,
                                pointBackgroundColor: trendColor,
                                borderWidth: 2,
                              }]
                            }}
                            options={{ ...barLineOption, plugins: { ...barLineOption.plugins, legend: { display: false } } }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {currentChart === 'summary' && (() => {
                    const summary = getExecutiveSummaryData();
                    const trendIcon = summary.trendDirection === 'up' ? '↑' : summary.trendDirection === 'down' ? '↓' : '→';
                    const statusIcon = summary.status === 'Healthy' ? '✓' : summary.status === 'Declining' ? '↓' : '!';
                    return (
                      <div className="slide-layout slide-summary">
                        <div className="summary-banner" style={{ '--status-color': summary.statusColor } as React.CSSProperties}>
                          <div className="summary-banner-left">
                            <span className="summary-banner-label">System Status</span>
                            <span className="summary-banner-value" style={{ color: summary.statusColor }}>{summary.status}</span>
                          </div>
                          <div className="summary-status-badge" style={{ background: `${summary.statusColor}20`, borderColor: summary.statusColor }}>
                            <span style={{ color: summary.statusColor, fontSize: 18, fontWeight: 800 }}>{statusIcon}</span>
                          </div>
                        </div>
                        <div className="summary-grid">
                          {[
                            { label: 'Total Activities', value: summary.totalActivities, icon: '📊' },
                            { label: 'Active Users', value: summary.uniqueUsers, icon: '👥' },
                            { label: 'Success Rate', value: `${summary.successRate}%`, icon: '✅' },
                            { label: 'Peak Hour', value: summary.peakHour, icon: '⏰' },
                          ].map(m => (
                            <div className="summary-metric" key={m.label}>
                              <span className="summary-metric-icon">{m.icon}</span>
                              <span className="summary-metric-value">{m.value}</span>
                              <span className="summary-metric-label">{m.label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="summary-bottom-row">
                          <div className="summary-rec">
                            <span className="summary-rec-title">📋 Recommendation</span>
                            <span className="summary-rec-text">{summary.mainRecommendation}</span>
                          </div>
                          <div className="summary-top-performer">
                            <span className="summary-tp-label">🏆 Top Performer</span>
                            <span className="summary-tp-name">{summary.topUser}</span>
                            <span className="summary-trend-badge" style={{
                              color: summary.trendDirection === 'up' ? '#22c55e' : summary.trendDirection === 'down' ? '#ef4444' : '#f59e0b'
                            }}>
                              {trendIcon} {summary.trendDirection}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>
            </div>
          </section>

          <section
            className="card activity-logs-card"
            onMouseEnter={() => setIsHoveringLogs(true)}
            onMouseLeave={() => setIsHoveringLogs(false)}
          >
            <div className="card-header">
              <h3>Activity Logs</h3>
              <div className="log-controls">
                <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="date-input" />
                {dateFilter && (
                  <button className="clear-filter-btn" onClick={() => setDateFilter('')} title="Clear filter">✕</button>
                )}
                <button onClick={handleExportToExcel} className="btn-excel-export" title="Export Excel">
                  <span>📊</span> Excel
                </button>
              </div>
            </div>
            <div className="logs-container" ref={logsContainerRef}>
              {filteredLogs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <p>{dateFilter ? 'No logs for selected date' : 'No activity logs'}</p>
                </div>
              ) : (
                <div className="logs-list">
                  {filteredLogs.map((log) => (
                    <div key={log.log_id} className="log-item">
                      <div className={`log-avatar ${getLogAvatarClass(log.action)}`}>{getLogAvatarLetter(log.action)}</div>
                      <div className="log-content">
                        <p className="log-action">{log.action}</p>
                        <p className="log-meta">
                          <span>{users.find(u => u.user_id === log.user_id)?.full_name || 'Unknown'}</span>
                          <span className="log-dot">•</span>
                          <span>{new Date(log.timestamp).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card users-card">
            <div className="card-header">
              <h3>Team Members</h3>
            </div>
            <div
              className="user-list-horizontal"
              ref={userListRef}
              onWheel={handleUserListWheel}
            >
              {sortedUsers.map(u => {
                const isSelected = selectedUser?.user_id === u.user_id;
                const accent = getRoleAccent(u.role);
                return (
                  <div
                    key={u.user_id}
                    className={`user-card user-card-${u.role} ${isSelected ? 'active' : ''}`}
                    style={{ '--role-bg': accent.bg, '--role-border': accent.border } as React.CSSProperties}
                  >
                    {isSelected && !isEditing && !isCreating && (
                      <button className="user-card-edit-btn" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} title="Edit">✎</button>
                    )}
                    {isSelected && isEditing && !isCreating && (
                      <div className="user-card-edit-actions">
                        <button className="user-card-save-btn" onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }} title="Save">✓</button>
                        <button className="user-card-cancel-btn" onClick={(e) => {
                          e.stopPropagation();
                          setIsEditing(false);
                          if (selectedUser) setEditFormData({ full_name: selectedUser.full_name, username: selectedUser.username, role: selectedUser.role });
                        }} title="Cancel">✕</button>
                      </div>
                    )}
                    {isSelected && !isEditing && !isCreating && (
                      <button className="user-card-delete-btn" onClick={(e) => { e.stopPropagation(); showConfirmDelete(u, () => handleDeleteUser(u)); }} title="Delete">🗑</button>
                    )}
                    <div className="user-card-role-stripe" />
                    <div className="user-card-content" onClick={() => handleSelectUser(u)}>
                      <div className="user-card-avatar-wrapper">
                        <img
                          src={getRoleIconUrl(u.role)}
                          alt={u.role}
                          className="user-card-avatar-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const parent = e.currentTarget.parentElement;
                            if (parent) {
                              parent.textContent = u.full_name.charAt(0).toUpperCase();
                              parent.style.background = u.role === 'admin' ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                : u.role === 'doctor' ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                                : 'linear-gradient(135deg, #f59e0b, #d97706)';
                              parent.style.display = 'flex';
                              parent.style.alignItems = 'center';
                              parent.style.justifyContent = 'center';
                              parent.style.color = 'white';
                              parent.style.fontWeight = '700';
                              parent.style.fontSize = '28px';
                            }
                          }}
                        />
                      </div>
                      <div className="user-card-info">
                        <p className="user-card-name">{u.full_name}</p>
                        <span className={`user-card-role-badge user-card-role-badge-${u.role}`}>
                          {accent.icon} {accent.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div
                className="user-card add-user-card"
                onClick={() => { setIsCreating(true); setSelectedUser(null); setIsEditing(false); setIsChangingPassword(false); }}
              >
                <div className="add-circle">
                  <span className="add-circle-icon">+</span>
                </div>
                <div className="user-card-info">
                  <p className="user-card-name add-title">Add Member</p>
                  <p className="user-card-role add-subtitle">Invite new team member</p>
                </div>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
};

export default DashboardAdmin;