import * as XLSX from 'xlsx';

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

const getRoleLabel = (role?: string): string =>
  role === 'admin' ? 'Administrator' : role === 'doctor' ? 'Doctor' : role === 'staff' ? 'Medical Staff' : 'Unknown';

const formatTimestamp = (ts: string): string =>
  new Date(ts).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

const formatDate = (ts: string): string =>
  new Date(ts).toLocaleDateString('id-ID');

const isErrorLog    = (action: string) => action.startsWith('ERROR|');
const isWarningLog  = (action: string) => action.startsWith('WARNING|');
const isSecurityLog = (action: string) =>
  action.toUpperCase().includes('LOGIN_FAILED') || action.toUpperCase().includes('LOGIN FAILED');

const getActionCategory = (action: string): string => {
  if (isErrorLog(action))   return 'ERROR';
  if (isWarningLog(action)) return 'WARNING';
  const a = action.toUpperCase();
  if (a.includes('LOGIN_FAILED')) return 'SECURITY';
  if (a.includes('CREATE'))       return 'CREATE';
  if (a.includes('UPDATE'))       return 'UPDATE';
  if (a.includes('DELETE'))       return 'DELETE';
  if (a.includes('LOGIN'))        return 'LOGIN';
  if (a.includes('EXTRACT'))      return 'EXTRACT';
  if (a.includes('UPLOAD'))       return 'UPLOAD';
  return 'OTHER';
};

const C = {
  blue:    '4F7EF8',
  blueDk:  '3A65E0',
  green:   '22C55E',
  red:     'EF4444',
  orange:  'F59E0B',
  purple:  '8B5CF6',
  teal:    '06B6D4',
  white:   'FFFFFF',
  surface: 'F7F8FB',
  border:  'E4E8F0',
  text:    '0D1117',
  sub:     '5A6478',
};

const S = {
  title:     (color = C.blue) => ({ font: { bold: true, sz: 13, color: { rgb: C.white }, name: 'Calibri' }, fill: { fgColor: { rgb: color }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center' } }),
  secHeader: (color = C.blueDk) => ({ font: { bold: true, sz: 10, color: { rgb: C.white }, name: 'Calibri' }, fill: { fgColor: { rgb: color }, patternType: 'solid' }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } }),
  colHeader: (color = C.blue) => ({ font: { bold: true, sz: 9.5, color: { rgb: C.white }, name: 'Calibri' }, fill: { fgColor: { rgb: color }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center' } }),
  label:     () => ({ font: { bold: true, sz: 9.5, color: { rgb: C.sub }, name: 'Calibri' }, fill: { fgColor: { rgb: C.surface }, patternType: 'solid' }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } }),
  value:     () => ({ font: { sz: 9.5, color: { rgb: C.text }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } }),
  valueC:    () => ({ font: { sz: 9.5, color: { rgb: C.text }, name: 'Calibri' }, alignment: { horizontal: 'center', vertical: 'center' } }),
  kpiValue:  (color = C.blue) => ({ font: { bold: true, sz: 14, color: { rgb: color }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } }),
  rowEven:   () => ({ font: { sz: 9.5, color: { rgb: C.text }, name: 'Calibri' }, fill: { fgColor: { rgb: C.white },   patternType: 'solid' }, alignment: { vertical: 'center' } }),
  rowOdd:    () => ({ font: { sz: 9.5, color: { rgb: C.text }, name: 'Calibri' }, fill: { fgColor: { rgb: C.surface }, patternType: 'solid' }, alignment: { vertical: 'center' } }),
  footer:    () => ({ font: { italic: true, sz: 8.5, color: { rgb: C.sub }, name: 'Calibri' }, alignment: { horizontal: 'center' } }),
  badge:     (color: string) => ({ font: { bold: true, sz: 8.5, color: { rgb: color }, name: 'Calibri' }, alignment: { horizontal: 'center' } }),
};

const actionBadgeColor = (action: string): string => {
  const cat = getActionCategory(action);
  if (cat === 'ERROR' || cat === 'SECURITY') return C.red;
  if (cat === 'WARNING') return C.orange;
  if (cat === 'CREATE')  return C.green;
  if (cat === 'UPDATE')  return C.orange;
  if (cat === 'DELETE')  return C.red;
  if (cat === 'LOGIN')   return C.blue;
  if (cat === 'EXTRACT' || cat === 'UPLOAD') return C.teal;
  return C.sub;
};

const setCell = (ws: XLSX.WorkSheet, r: number, c: number, v: string | number, style?: object) => {
  ws[XLSX.utils.encode_cell({ r, c })] = { v, t: typeof v === 'number' ? 'n' : 's', s: style };
};

const merge = (ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number) => {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
};

const sectionHeader = (ws: XLSX.WorkSheet, r: number, text: string, cols: number, color = C.blueDk) => {
  setCell(ws, r, 0, text, S.secHeader(color));
  merge(ws, r, 0, r, cols - 1);
};

function buildSummarySheet(logs: Log[], users: User[], dateFilter: string, selectedUser: User | null): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 6;
  let r = 0;

  const total       = logs.length;
  const errorLogs   = logs.filter(l => isErrorLog(l.action) || isWarningLog(l.action));
  const securityEvt = logs.filter(l => isSecurityLog(l.action));
  const successRate = total > 0 ? (((total - errorLogs.length) / total) * 100).toFixed(1) : '100';
  const activeUsers = new Set(logs.map(l => l.user_id)).size;

  const actionMap: Record<string, number> = {};
  logs.forEach(l => {
    const cat = getActionCategory(l.action);
    actionMap[cat] = (actionMap[cat] || 0) + 1;
  });

  const userActivity = users
    .map(u => ({ name: u.full_name, count: logs.filter(l => l.user_id === u.user_id).length }))
    .filter(u => u.count > 0)
    .sort((a, b) => b.count - a.count);

  const dailyMap: Record<string, number> = {};
  logs.forEach(l => { const d = l.timestamp.split('T')[0]; dailyMap[d] = (dailyMap[d] || 0) + 1; });
  const daily = Object.entries(dailyMap).sort((a, b) => a[0].localeCompare(b[0])).slice(-7)
    .map(([date, count]) => ({ date: formatDate(date + 'T00:00:00'), count }));
  const avgDaily = daily.length > 0 ? (daily.reduce((s, d) => s + d.count, 0) / daily.length).toFixed(1) : '0';

  setCell(ws, r, 0, 'ACTIVITY REPORT — SUMMARY DASHBOARD', S.title());
  merge(ws, r, 0, r, COLS - 1);
  r++;

  setCell(ws, r, 0, `Generated: ${new Date().toLocaleString('id-ID')}  |  Scope: ${selectedUser ? selectedUser.full_name : 'All Users'}  |  Date Filter: ${dateFilter || 'None'}`, S.footer());
  merge(ws, r, 0, r, COLS - 1);
  r += 2;

  sectionHeader(ws, r, 'KEY PERFORMANCE INDICATORS', COLS);
  r++;

  const kpis = [
    { label: 'Total Logs',      value: total,            color: C.blue   },
    { label: 'Active Users',    value: activeUsers,      color: C.purple },
    { label: 'Success Rate',    value: `${successRate}%`, color: C.green },
    { label: 'Errors/Warnings', value: errorLogs.length, color: errorLogs.length > 0 ? C.red : C.green },
    { label: 'Security Events', value: securityEvt.length, color: securityEvt.length > 0 ? C.red : C.green },
    { label: 'Daily Avg (7d)',  value: avgDaily,          color: C.teal  },
  ];

  kpis.forEach((k, i) => {
    setCell(ws, r,     i, k.label,  S.label());
    setCell(ws, r + 1, i, k.value,  S.kpiValue(k.color));
  });
  r += 3;

  sectionHeader(ws, r, 'ACTION BREAKDOWN', COLS);
  r++;
  ['Action Category', 'Count', 'Percentage', '', '', ''].forEach((h, i) => setCell(ws, r, i, h, S.colHeader()));
  r++;

  const sortedActions = Object.entries(actionMap).sort((a, b) => b[1] - a[1]);
  sortedActions.forEach(([cat, count], i) => {
    const rs = i % 2 === 0 ? S.rowEven() : S.rowOdd();
    setCell(ws, r, 0, cat,                         S.badge(actionBadgeColor(cat)));
    setCell(ws, r, 1, count,                        { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 2, `${((count / total) * 100).toFixed(1)}%`, { ...S.valueC(), ...(rs as object) });
    r++;
  });
  if (!sortedActions.length) { setCell(ws, r, 0, 'No actions recorded', S.footer()); merge(ws, r, 0, r, COLS - 1); r++; }
  r++;

  sectionHeader(ws, r, 'TOP PERFORMERS (by activity count)', COLS, C.purple);
  r++;
  ['Rank', 'Full Name', 'Actions', '% of Total', '', ''].forEach((h, i) => setCell(ws, r, i, h, S.colHeader(C.purple)));
  r++;

  userActivity.slice(0, 5).forEach((u, i) => {
    const rs = i % 2 === 0 ? S.rowEven() : S.rowOdd();
    setCell(ws, r, 0, `#${i + 1}`,                                    { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 1, u.name,                                          rs);
    setCell(ws, r, 2, u.count,                                         { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 3, `${((u.count / total) * 100).toFixed(1)}%`,     { ...S.valueC(), ...(rs as object) });
    r++;
  });
  if (!userActivity.length) { setCell(ws, r, 0, 'No activity data', S.footer()); merge(ws, r, 0, r, COLS - 1); r++; }
  r++;

  sectionHeader(ws, r, 'DAILY ACTIVITY TREND — Last 7 Days', COLS, C.teal.replace('06B6D4', '0891B2'));
  r++;
  ['Date', 'Count', 'vs Average', '', '', ''].forEach((h, i) => setCell(ws, r, i, h, S.colHeader(C.teal)));
  r++;

  daily.forEach((d, i) => {
    const diff = d.count - Number(avgDaily);
    const vs   = diff > 0 ? `▲ +${diff.toFixed(0)}` : diff < 0 ? `▼ ${diff.toFixed(0)}` : '→ 0';
    const rs   = i % 2 === 0 ? S.rowEven() : S.rowOdd();
    setCell(ws, r, 0, d.date,   rs);
    setCell(ws, r, 1, d.count,  { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 2, vs,       { ...S.valueC(), ...(rs as object) });
    r++;
  });
  if (!daily.length) { setCell(ws, r, 0, 'No daily data', S.footer()); merge(ws, r, 0, r, COLS - 1); r++; }
  r++;

  sectionHeader(ws, r, 'INSIGHTS', COLS);
  r++;

  const insights = [
    total === 0
      ? 'ℹ️ No activity recorded for selected period.'
      : `📊 ${total} activities across ${activeUsers} user(s) recorded.`,
    userActivity[0] ? `🏆 Most active: ${userActivity[0].name} with ${userActivity[0].count} activities.` : null,
    avgDaily !== '0' ? `📈 Average daily activity: ${avgDaily} actions/day.` : null,
    securityEvt.length > 0 ? `⚠️ ${securityEvt.length} security event(s) detected. Review immediately.` : '✅ No security events detected.',
    errorLogs.length > 0   ? `🔴 ${errorLogs.length} error/warning log(s) found. See Error Sheet.`       : '✅ No errors or warnings logged.',
  ].filter(Boolean) as string[];

  insights.forEach(insight => {
    setCell(ws, r, 0, insight, { font: { italic: true, sz: 9.5, color: { rgb: C.sub }, name: 'Calibri' }, fill: { fgColor: { rgb: C.surface }, patternType: 'solid' }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true, indent: 1 } });
    merge(ws, r, 0, r, COLS - 1);
    r++;
  });
  r++;

  setCell(ws, r, 0, `© ${new Date().getFullYear()} StegoShield — Confidential`, S.footer());
  merge(ws, r, 0, r, COLS - 1);

  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
  return ws;
}

function buildActivitySheet(logs: Log[], users: User[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 8;
  let r = 0;

  setCell(ws, r, 0, 'ACTIVITY LOGS — FULL DETAIL', S.title());
  merge(ws, r, 0, r, COLS - 1);
  r++;

  setCell(ws, r, 0, `Total: ${logs.length} records  |  Exported: ${new Date().toLocaleString('id-ID')}`, S.footer());
  merge(ws, r, 0, r, COLS - 1);
  r += 2;

  ['#', 'Log ID', 'Full Name', 'Username', 'Role', 'Category', 'Action', 'Timestamp'].forEach((h, i) =>
    setCell(ws, r, i, h, S.colHeader())
  );
  r++;

  [...logs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).forEach((log, i) => {
    const user = users.find(u => u.user_id === log.user_id);
    const cat  = getActionCategory(log.action);
    const rs   = i % 2 === 0 ? S.rowEven() : S.rowOdd();

    setCell(ws, r, 0, i + 1,                         { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 1, log.log_id,                     { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 2, user?.full_name  || 'Unknown',  { ...(rs as object), font: { ...(rs as any).font, bold: true } });
    setCell(ws, r, 3, user?.username   || 'Unknown',  rs);
    setCell(ws, r, 4, getRoleLabel(user?.role),        { ...S.valueC(), ...(rs as object) });
    setCell(ws, r, 5, cat,                             S.badge(actionBadgeColor(log.action)));
    setCell(ws, r, 6, log.action,                      rs);
    setCell(ws, r, 7, formatTimestamp(log.timestamp),  { ...S.valueC(), ...(rs as object) });
    r++;
  });

  if (!logs.length) {
    setCell(ws, r, 0, 'No records found.', { ...S.footer(), alignment: { horizontal: 'center' } });
    merge(ws, r, 0, r, COLS - 1);
    r++;
  }

  r++;
  setCell(ws, r, 0, `End of Report — ${logs.length} records`, S.footer());
  merge(ws, r, 0, r, COLS - 1);

  ws['!cols'] = [{ wch: 6 }, { wch: 8 }, { wch: 24 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 50 }, { wch: 22 }];
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
  return ws;
}

function buildErrorSheet(logs: Log[], users: User[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 7;
  let r = 0;

  const errorLogs    = logs.filter(l => isErrorLog(l.action) || isWarningLog(l.action));
  const securityLogs = logs.filter(l => isSecurityLog(l.action) && !isErrorLog(l.action));
  const combined     = [...errorLogs, ...securityLogs]
    .filter((v, i, a) => a.findIndex(x => x.log_id === v.log_id) === i)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  setCell(ws, r, 0, 'ERROR & SECURITY LOGS', S.title(C.red));
  merge(ws, r, 0, r, COLS - 1);
  r++;

  setCell(ws, r, 0, `${combined.length} event(s) found  |  Exported: ${new Date().toLocaleString('id-ID')}`, S.footer());
  merge(ws, r, 0, r, COLS - 1);
  r += 2;

  sectionHeader(ws, r, 'QUICK SUMMARY', COLS, C.red);
  r++;
  const summaryItems = [
    { label: 'Total Errors/Warnings', value: errorLogs.length    },
    { label: 'Security Events',       value: securityLogs.length },
    { label: 'Total Combined',        value: combined.length     },
  ];
  summaryItems.forEach((s, i) => {
    setCell(ws, r,     i * 2,     s.label, S.label());
    setCell(ws, r + 1, i * 2,     s.value, S.kpiValue(C.red));
  });
  r += 3;

  sectionHeader(ws, r, 'DETAILED ERROR & SECURITY LOG', COLS, C.red);
  r++;
  ['#', 'Log ID', 'Full Name', 'Type', 'Action / Detail', 'Module', 'Timestamp'].forEach((h, i) =>
    setCell(ws, r, i, h, S.colHeader(C.red))
  );
  r++;

  if (!combined.length) {
    setCell(ws, r, 0, '✅ No errors or security events found.', { ...S.footer(), alignment: { horizontal: 'center' } });
    merge(ws, r, 0, r, COLS - 1);
    r++;
  } else {
    combined.forEach((log, i) => {
      const user = users.find(u => u.user_id === log.user_id);
      const cat  = getActionCategory(log.action);
      const rs   = i % 2 === 0 ? S.rowEven() : S.rowOdd();

      const moduleMatch = log.action.match(/^(?:ERROR|WARNING)\|([^:]+)/);
      const module      = moduleMatch ? moduleMatch[1].replace(/_FAILED$/, '').replace(/_/g, ' ') : '—';

      setCell(ws, r, 0, i + 1,                        { ...S.valueC(), ...(rs as object) });
      setCell(ws, r, 1, log.log_id,                   { ...S.valueC(), ...(rs as object) });
      setCell(ws, r, 2, user?.full_name || 'Unknown', rs);
      setCell(ws, r, 3, cat,                          S.badge(actionBadgeColor(log.action)));
      setCell(ws, r, 4, log.action,                   rs);
      setCell(ws, r, 5, module,                       { ...S.valueC(), ...(rs as object) });
      setCell(ws, r, 6, formatTimestamp(log.timestamp), { ...S.valueC(), ...(rs as object) });
      r++;
    });
  }

  r++;
  setCell(ws, r, 0, `End of Error Report — ${combined.length} event(s)`, S.footer());
  merge(ws, r, 0, r, COLS - 1);

  ws['!cols'] = [{ wch: 6 }, { wch: 8 }, { wch: 24 }, { wch: 12 }, { wch: 55 }, { wch: 22 }, { wch: 22 }];
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
  return ws;
}

export const exportToExcel = (
  logs: Log[],
  users: User[],
  dateFilter: string,
  selectedUser: User | null,
  showNotification?: (message: string, type: 'success' | 'error' | 'warning') => void
): void => {
  if (!logs.length) { showNotification?.('No logs to export', 'warning'); return; }

  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSummarySheet(logs, users, dateFilter, selectedUser), 'Summary');
    XLSX.utils.book_append_sheet(wb, buildActivitySheet(logs, users), 'Activity Logs');
    XLSX.utils.book_append_sheet(wb, buildErrorSheet(logs, users), 'Errors & Security');

    const date   = new Date().toISOString().split('T')[0];
    const suffix = [selectedUser ? `_${selectedUser.username}` : '', dateFilter ? `_${dateFilter}` : ''].join('');
    XLSX.writeFile(wb, `stegoshield_report${suffix}_${date}.xlsx`);

    showNotification?.(`✅ Exported ${logs.length} logs to Excel (3 sheets)`, 'success');
  } catch {
    showNotification?.('Failed to export Excel', 'error');
  }
};

export const exportToCSV = (
  logs: Log[],
  users: User[],
  dateFilter: string,
  selectedUser: User | null,
  showNotification?: (message: string, type: 'success' | 'error' | 'warning') => void
): void => {
  if (!logs.length) { showNotification?.('No logs to export', 'warning'); return; }

  try {
    const headers = ['Log ID', 'Full Name', 'Username', 'Role', 'Category', 'Action', 'Timestamp'];
    const esc     = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows    = logs.map(log => {
      const u = users.find(x => x.user_id === log.user_id);
      return [log.log_id, u?.full_name || 'Unknown', u?.username || 'Unknown',
        getRoleLabel(u?.role), getActionCategory(log.action), log.action,
        formatTimestamp(log.timestamp)].map(esc).join(',');
    });

    const csv  = [headers.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');

    const date   = new Date().toISOString().split('T')[0];
    const suffix = [selectedUser ? `_${selectedUser.username}` : '', dateFilter ? `_${dateFilter}` : ''].join('');
    a.href = url;
    a.setAttribute('download', `stegoshield_logs${suffix}_${date}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification?.(`✅ Exported ${logs.length} logs to CSV`, 'success');
  } catch {
    showNotification?.('Failed to export CSV', 'error');
  }
};