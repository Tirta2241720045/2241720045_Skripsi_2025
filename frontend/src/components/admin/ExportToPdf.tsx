import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

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

interface ChartImages {
  pie:  string | null;
  bar:  string | null;
  line: string | null;
}

const sanitize = (text: string): string => {
  if (!text) return '';
  const map: Record<string, string> = {
    'æ':'ae','ø':'o','å':'a','ö':'o','ä':'a','ü':'u',
    'é':'e','è':'e','ê':'e','ë':'e','í':'i','ì':'i','î':'i','ï':'i',
    'ó':'o','ò':'o','ô':'o','õ':'o','ú':'u','ù':'u','û':'u',
    'ý':'y','ÿ':'y','ñ':'n','ç':'c','š':'s','ž':'z','đ':'d',
  };
  return text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, c => map[c] || '');
};

const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;

const wrapEvery = (s: string, n: number): string => {
  const t = trunc(s, n * 2);
  return t.split('').reduce((acc, c, i) => acc + (i > 0 && i % n === 0 ? '\n' : '') + c, '');
};

const isError    = (a: string) => a.startsWith('ERROR|');
const isWarning  = (a: string) => a.startsWith('WARNING|');
const isSecurity = (a: string) => a.toUpperCase().includes('LOGIN_FAILED') || a.toUpperCase().includes('LOGIN FAILED');

export const captureAllCharts = async (
  pieRef:  React.RefObject<HTMLDivElement | null>,
  barRef:  React.RefObject<HTMLDivElement | null>,
  lineRef: React.RefObject<HTMLDivElement | null>
): Promise<ChartImages> => {
  const opts = { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false };
  const capture = async (ref: React.RefObject<HTMLDivElement | null>): Promise<string | null> => {
    if (!ref.current) return null;
    try { return (await html2canvas(ref.current, opts)).toDataURL('image/png'); }
    catch { return null; }
  };
  const [pie, bar, line] = await Promise.all([capture(pieRef), capture(barRef), capture(lineRef)]);
  return { pie, bar, line };
};

export const exportToPDF = async (
  users:               User[],
  allLogs:             Log[],
  selectedUser:        User | null,
  dateFilter:          string,
  roleCounts:          { admin: number; staff: number; doctor: number },
  activityByUser:      { labels: string[]; data: number[] },
  activityByDay:       { labels: string[]; data: number[] },
  getCurrentMonthStats: () => { total: number; topActions: [string, number][]; uniqueUsers: number },
  getCurrentMonthLogs:  () => Log[],
  generateInsights:     () => string[],
  chartImages:         ChartImages,
  showNotification:    (msg: string, type: 'success' | 'error' | 'warning') => void
): Promise<void> => {

  const doc = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
  doc.setFont('helvetica');

  const PW   = doc.internal.pageSize.getWidth();   
  const PH   = doc.internal.pageSize.getHeight(); 
  const MG   = 14;
  const CW   = PW - MG * 2;                       
  const FH   = 10;
  const GAP  = 10;
  const TOP  = 22;
  const now  = new Date();
  const genTime = now.toLocaleDateString('en-US', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  type RGB = [number, number, number];
  const C: Record<string, RGB> = {
    blue:   [41,  98, 255], blueL: [79, 126, 248],
    green:  [16, 185, 129], purple:[139, 92, 246],
    red:    [220,  38,  38], amber: [217, 119,  6],
    teal:   [6,  182, 212], dark:  [24,  24,  27],
    mid:    [63,  63,  70], sub:   [113, 113, 122],
    line:   [212, 212, 216], bg:    [250, 250, 252],
    white:  [255, 255, 255],
  };

  let y = 0;

  const setColor = (...rgb: RGB) => doc.setTextColor(...rgb);
  const setFill  = (...rgb: RGB) => doc.setFillColor(...rgb);
  const setDraw  = (...rgb: RGB) => doc.setDrawColor(...rgb);

  const txt = (text: string, x: number, yy: number, opts?: object) =>
    doc.text(sanitize(text), x, yy, opts as any);

  const needsPage = (h: number) => {
    if (y + h > PH - FH - 4) { doc.addPage(); y = TOP; }
  };

  const fillRound = (x: number, yy: number, w: number, h: number, fill: RGB, stroke?: RGB, r = 2.5) => {
    setFill(...fill);
    if (stroke) { setDraw(...stroke); doc.roundedRect(x, yy, w, h, r, r, 'FD'); }
    else          doc.roundedRect(x, yy, w, h, r, r, 'F');
  };

  const rule = (color: RGB = C.line, before = 4, after = 6) => {
    y += before; setDraw(...color); doc.setLineWidth(0.2);
    doc.line(MG, y, PW - MG, y); y += after;
  };

  const sectionLabel = (title: string, color: RGB = C.blueL, right?: string) => {
    needsPage(12);
    setFill(...color); doc.rect(MG, y, 3, 8, 'F');
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); setColor(...C.dark);
    txt(title, MG + 7, y + 6);
    if (right) { doc.setFontSize(7); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(right, PW - MG, y + 6, { align: 'right' }); }
    y += 12;
  };

  const CARD_H = 32;

  const kpiCard = (x: number, yy: number, w: number, label: string, value: string, sub: string, color: RGB) => {
    fillRound(x, yy, w, CARD_H, C.bg, C.line, 3);
    setFill(...color); doc.roundedRect(x, yy, w, 2.5, 1.5, 1.5, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(label.toUpperCase(), x + 5, yy + 9);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');   setColor(...color);  txt(value, x + 5, yy + 22);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(sub, x + 5, yy + 29);
  };

  const kpiCardMultiline = (x: number, yy: number, w: number, label: string, value: string, sub: string, color: RGB) => {
    fillRound(x, yy, w, CARD_H, C.bg, C.line, 3);
    setFill(...color); doc.roundedRect(x, yy, w, 2.5, 1.5, 1.5, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(label.toUpperCase(), x + 5, yy + 9);
    doc.setFontSize(10);  doc.setFont('helvetica', 'bold');   setColor(...color);
    const lines = value.split('\n');
    lines.forEach((line, i) => txt(line, x + 5, yy + 18 + i * 4.5));
    const lastY = yy + 18 + (lines.length - 1) * 4.5;
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(sub, x + 5, lastY + 7);
  };

  const hBar = (x: number, yy: number, w: number, h: number, pct: number, color: RGB) => {
    fillRound(x, yy, w, h, [228, 228, 231] as RGB, undefined, 1.5);
    if (pct > 0) fillRound(x, yy, Math.max(w * Math.min(pct, 1), 1.5), h, color, undefined, 1.5);
  };

  const badge = (x: number, yy: number, label: string, bg: RGB, fg: RGB) => {
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
    const tw = (doc as any).getStringUnitWidth(sanitize(label)) * 6.5 / doc.internal.scaleFactor + 5;
    fillRound(x, yy - 4, tw, 5.5, bg, undefined, 1.5);
    setColor(...fg); txt(label, x + 2.5, yy);
  };

  const pageStrip = (left: string, right: string, color: RGB) => {
    setFill(...color); doc.rect(0, 0, PW, 14, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); setColor(...C.white); txt(left, MG, 9);
    doc.setFont('helvetica', 'normal'); setColor(210, 220, 255); txt(right, PW - MG, 9, { align: 'right' });
  };

  const stampFooters = () => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      setFill(245, 245, 248); doc.rect(0, PH - FH, PW, FH, 'F');
      setDraw(...C.line); doc.setLineWidth(0.2); doc.line(0, PH - FH, PW, PH - FH);
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub);
      txt('StegoShield  —  Confidential System Report', MG, PH - 3.5);
      txt(`Page ${i} / ${total}   |   ${genTime}`, PW - MG, PH - 3.5, { align: 'right' });
    }
  };

  const baseLogs    = selectedUser ? allLogs.filter(l => l.user_id === selectedUser.user_id) : allLogs;
  const monthStats  = getCurrentMonthStats();
  const monthLogs   = getCurrentMonthLogs();
  const errorLogs   = baseLogs.filter(l => isError(l.action) || isWarning(l.action));
  const secEvt      = baseLogs.filter(l => isSecurity(l.action));
  const failedCount = secEvt.length;
  const successRate = baseLogs.length > 0
    ? (baseLogs.filter(l => !isError(l.action) && !isSecurity(l.action)).length / baseLogs.length) * 100
    : 100;
  const activeUsers = new Set(baseLogs.map(l => l.user_id)).size;
  const total7d     = activityByDay.data.reduce((a, b) => a + b, 0);
  const avg7d       = activityByDay.data.length ? total7d / activityByDay.data.length : 0;
  const peak7d      = activityByDay.data.length ? Math.max(...activityByDay.data) : 0;
  const trendVal    = activityByDay.data.length > 1 ? activityByDay.data.at(-1)! - activityByDay.data[0] : 0;
  const trendDir    = trendVal > 0 ? 'Increasing' : trendVal < 0 ? 'Decreasing' : 'Stable';
  const trendColor  = trendVal > 0 ? C.green : trendVal < 0 ? C.red : C.amber;
  const sysStatus   = failedCount > 5 || errorLogs.length > 10 ? 'NEEDS ATTENTION' : successRate < 80 ? 'WARNING' : 'HEALTHY';
  const sysColor    = sysStatus === 'HEALTHY' ? C.green : sysStatus === 'WARNING' ? C.amber : C.red;

  const hours = Array(24).fill(0);
  baseLogs.forEach(l => hours[new Date(l.timestamp).getHours()]++);
  const peakHour      = hours.indexOf(Math.max(...hours));
  const peakHourCount = hours[peakHour];

  const perfMap: Record<number, { name: string; count: number; role: string }> = {};
  baseLogs.forEach(l => {
    const u = users.find(x => x.user_id === l.user_id);
    if (u) {
      if (!perfMap[l.user_id]) perfMap[l.user_id] = { name: u.full_name, count: 0, role: u.role };
      perfMap[l.user_id].count++;
    }
  });
  const topPerfs = Object.values(perfMap).sort((a, b) => b.count - a.count);

  const actionMap: Record<string, number> = { CREATE:0, UPDATE:0, DELETE:0, LOGIN:0, EXTRACT:0, UPLOAD:0, ERROR:0, OTHER:0 };
  baseLogs.forEach(l => {
    const a = l.action.toUpperCase();
    if (isError(l.action) || isWarning(l.action)) actionMap['ERROR']++;
    else if (a.includes('CREATE'))  actionMap['CREATE']++;
    else if (a.includes('UPDATE'))  actionMap['UPDATE']++;
    else if (a.includes('DELETE'))  actionMap['DELETE']++;
    else if (a.includes('LOGIN'))   actionMap['LOGIN']++;
    else if (a.includes('EXTRACT')) actionMap['EXTRACT']++;
    else if (a.includes('UPLOAD'))  actionMap['UPLOAD']++;
    else                            actionMap['OTHER']++;
  });

  setFill(...C.blue); doc.rect(0, 0, PW, 48, 'F');
  setFill(60, 110, 255); doc.circle(PW - 18, 8, 26, 'F');
  setFill(30,  72, 220); doc.circle(PW - 4, 38, 14, 'F');

  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); setColor(...C.white);
  txt('StegoShield', MG, 17);
  doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); setColor(190, 210, 255);
  txt('System Activity & Analytics Report', MG, 26);
  doc.setFontSize(7.5); setColor(160, 190, 255);
  txt(`Generated: ${genTime}`, MG, 34);

  if (selectedUser) {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(...C.white);
    txt(`User: ${sanitize(selectedUser.full_name)} (@${selectedUser.username})`, PW - MG, 27, { align: 'right' });
  }
  if (dateFilter) {
    const [yr, mo, dy] = dateFilter.split('-');
    const df = new Date(+yr, +mo - 1, +dy).toLocaleDateString('en-US', { day:'2-digit', month:'long', year:'numeric' });
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); setColor(190, 210, 255);
    txt(`Filter: ${df}`, PW - MG, selectedUser ? 34 : 27, { align: 'right' });
  }

  y = 56;

  const kW = (CW - 9) / 4;
  kpiCard(MG,        y, kW, 'Total Users',      users.length.toString(),        `${roleCounts.admin}A · ${roleCounts.doctor}D · ${roleCounts.staff}S`, C.blueL);
  kpiCard(MG+kW+3,   y, kW, 'Total Activities', baseLogs.length.toString(),     `${monthStats.total} this month`, C.green);
  kpiCard(MG+kW*2+6, y, kW, 'Success Rate',     `${successRate.toFixed(1)}%`,   `${failedCount} security event(s)`, failedCount > 0 ? C.red : C.green);
  kpiCard(MG+kW*3+9, y, kW, 'Errors/Warnings',  errorLogs.length.toString(),    `${activeUsers} active user(s)`, errorLogs.length > 0 ? C.red : C.green);
  y += CARD_H + 8;

  const snapW = (CW - 9) / 4;
  const snaps = [
    { label: 'System Status',  value: sysStatus,                          color: sysColor  },
    { label: 'Activity Trend', value: trendDir,                           color: trendColor},
    { label: 'Peak Hour',      value: `${String(peakHour).padStart(2,'0')}:00`, color: C.blueL  },
    { label: 'Daily Avg (7d)', value: avg7d.toFixed(1),                   color: C.purple  },
  ];
  snaps.forEach((s, i) => {
    const sx = MG + i * (snapW + 3);
    fillRound(sx, y, snapW, 20, C.bg, C.line, 2.5);
    setFill(...s.color); doc.rect(sx, y, snapW, 2, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub); txt(s.label.toUpperCase(), sx + 4, y + 8);
    doc.setFontSize(9);   doc.setFont('helvetica', 'bold');   setColor(...s.color); txt(s.value, sx + 4, y + 16);
  });
  y += 26;

  fillRound(MG, y, CW, 12, [239,246,255] as RGB, [193,214,254] as RGB, 2.5);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(...C.blueL); txt('SCOPE', MG + 5, y + 5);
  doc.setFont('helvetica', 'normal'); setColor(...C.mid);
  txt(selectedUser ? `Filtered to ${sanitize(selectedUser.full_name)} (${selectedUser.role}).` : `All ${users.length} users, ${baseLogs.length} total activities.`, MG + 22, y + 5);
  doc.setFontSize(7); setColor(...C.sub);
  txt(`Report date: ${now.toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'})}${dateFilter ? `   |   Filter: ${dateFilter}` : ''}`, PW - MG, y + 5, { align: 'right' });
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(...C.sub);
  txt('Contents: Team Composition · Activity · Action Analytics · Error Summary · User Roster · Insights', MG + 5, y + 10);
  y += 18;

  sectionLabel('Team Composition', C.blueL, `${users.length} users`);
  const roleRows = [
    { label:'Administrator', count: roleCounts.admin,  color: C.red   },
    { label:'Doctor',        count: roleCounts.doctor, color: C.green },
    { label:'Medical Staff', count: roleCounts.staff,  color: C.amber },
  ];
  roleRows.forEach(r => {
    const pct = users.length > 0 ? r.count / users.length : 0;
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); setColor(...r.color); txt(r.label, MG, y + 4);
    doc.setFont('helvetica', 'normal'); setColor(...C.sub); doc.setFontSize(7.5);
    txt(`${r.count} (${(pct * 100).toFixed(0)}%)`, MG + 40, y + 4);
    hBar(MG + 70, y - 1, CW - 76, 6, pct, r.color); y += 9;
  });
  y += 4;

  if (chartImages.pie) {
    needsPage(58); doc.setFontSize(7.5); doc.setFont('helvetica','italic'); setColor(...C.sub);
    txt('Role Distribution (visual)', MG, y); y += 3;
    doc.addImage(chartImages.pie, 'PNG', MG + CW / 4, y, CW / 2, 48); y += 52;
  }

  doc.addPage(); y = TOP;
  pageStrip('ACTIVITY OVERVIEW  ·  ACTION ANALYTICS', genTime, C.green);

  sectionLabel('Activity Overview — Last 7 Days', C.green, `Peak: ${peak7d}`);

  const trendPct = activityByDay.data[0] > 0
    ? (((activityByDay.data.at(-1)! - activityByDay.data[0]) / activityByDay.data[0]) * 100).toFixed(1) : '0';

  const aKpis = [
    { label:'7-Day Total',   value: total7d.toString(),  sub:'actions recorded',                        color: C.green  },
    { label:'Daily Average', value: avg7d.toFixed(1),    sub:'per day',                                 color: C.blueL  },
    { label:'Peak Day',      value: peak7d.toString(),   sub: activityByDay.labels[activityByDay.data.indexOf(peak7d)] || '—', color: C.purple },
    { label:'Trend',         value: `${trendVal >= 0 ? '+' : ''}${trendVal}`, sub:`${trendPct}% vs. day 1`, color: trendColor },
  ];
  const aW = (CW - 9) / 4;
  aKpis.forEach((k, i) => kpiCard(MG + i * (aW + 3), y, aW, k.label, k.value, k.sub, k.color));
  y += CARD_H + 6;

  if (chartImages.bar) {
    needsPage(66); doc.setFontSize(7.5); doc.setFont('helvetica','italic'); setColor(...C.sub);
    txt('Top 5 Most Active Users', MG, y); y += 3;
    doc.addImage(chartImages.bar, 'PNG', MG, y, CW, 56); y += 60;
  }

  needsPage(60);
  sectionLabel('Daily Breakdown', C.green, 'Last 7 days');

  if (activityByDay.labels.length) {
    autoTable(doc, {
      startY: y,
      head: [['Date','Day','Actions','vs. Avg','Sparkbar']],
      body: activityByDay.labels.map((date, i) => {
        const d = new Date(date); const count = activityByDay.data[i]; const diff = count - avg7d;
        return [
          d.toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }),
          d.toLocaleDateString('en-US', { weekday:'short' }),
          count.toString(),
          diff >= 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0),
          '|'.repeat(Math.round((count / Math.max(peak7d, 1)) * 16)),
        ];
      }),
      theme: 'striped',
      headStyles: { fillColor: C.green, textColor: C.white, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
      bodyStyles: { fontSize:7.5, cellPadding:3, font:'helvetica', textColor:[50,50,50] },
      columnStyles: { 0:{cellWidth:36}, 1:{cellWidth:16}, 2:{cellWidth:22}, 3:{cellWidth:20}, 4:{cellWidth:'auto'} },
      margin: { left: MG, right: MG },
      didParseCell: (d: any) => {
        if (d.section === 'body' && d.column.index === 3) {
          const v = String(d.cell.raw);
          d.cell.styles.textColor = v.startsWith('+') ? [21,128,61] : v.startsWith('-') ? [185,28,28] : [100,100,100];
          d.cell.styles.fontStyle = 'bold';
        }
        if (d.section === 'body' && d.column.index === 4) {
          d.cell.styles.textColor = [16,185,129]; d.cell.styles.font = 'courier'; d.cell.styles.fontSize = 7;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + GAP;
  }

  needsPage(14);
  sectionLabel('Action Analytics', C.amber, `${baseLogs.length} actions`);

  const actionTotal = Object.values(actionMap).reduce((a, b) => a + b, 0);
  const maxAction   = Math.max(...Object.values(actionMap), 1);
  const actionRows  = Object.entries(actionMap).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const aColMap: Record<string, RGB> = {
    CREATE: C.green, UPDATE: C.blueL, DELETE: C.red, LOGIN: C.purple,
    EXTRACT: C.teal, UPLOAD: C.teal, ERROR: C.red, OTHER: C.amber,
  };
  const riskMap: Record<string, string> = {
    CREATE:'Low', UPDATE:'Low', DELETE:'High', LOGIN:'Medium',
    EXTRACT:'Low', UPLOAD:'Low', ERROR:'High', OTHER:'Low',
  };

  autoTable(doc, {
    startY: y,
    head: [['Category','Count','%','Risk','Distribution']],
    body: actionRows.map(([cat, count]) => [
      cat, count.toString(),
      `${actionTotal > 0 ? ((count / actionTotal) * 100).toFixed(1) : 0}%`,
      riskMap[cat] || 'Low',
      '|'.repeat(Math.round((count / maxAction) * 18)),
    ]),
    theme: 'striped',
    headStyles: { fillColor: C.amber, textColor: C.white, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
    bodyStyles: { fontSize:7.5, cellPadding:3.5, font:'helvetica', textColor:[50,50,50] },
    columnStyles: { 0:{cellWidth:22}, 1:{cellWidth:18}, 2:{cellWidth:18}, 3:{cellWidth:20}, 4:{cellWidth:'auto'} },
    margin: { left: MG, right: MG },
    didParseCell: (d: any) => {
      if (d.section === 'body') {
        if (d.column.index === 0) { d.cell.styles.textColor = aColMap[String(d.cell.raw)] || [50,50,50]; d.cell.styles.fontStyle = 'bold'; }
        if (d.column.index === 3) {
          const v = String(d.cell.raw);
          d.cell.styles.textColor = v === 'High' ? [185,28,28] : v === 'Medium' ? [154,70,0] : [21,128,61];
          d.cell.styles.fontStyle = 'bold';
        }
        if (d.column.index === 4) { d.cell.styles.textColor = [217,119,6]; d.cell.styles.font = 'courier'; d.cell.styles.fontSize = 7; }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + GAP;

  doc.addPage(); y = TOP;
  pageStrip('ERROR SUMMARY  ·  MONTHLY ACTIVITY  ·  USER ROSTER', genTime, C.red);

  sectionLabel('Error & Security Summary', C.red, `${errorLogs.length + secEvt.length} event(s)`);

  const eW = (CW - 9) / 4;
  const eKpis = [
    { label:'Total Errors',    value: errorLogs.filter(l => isError(l.action)).length.toString(),    sub:'ERROR| prefixed',        color: C.red   },
    { label:'Total Warnings',  value: errorLogs.filter(l => isWarning(l.action)).length.toString(),  sub:'WARNING| prefixed',      color: C.amber },
    { label:'Security Events', value: secEvt.length.toString(),                                       sub:'failed login attempts',  color: C.red   },
    { label:'System Health',   value: sysStatus,                                                      sub:`${successRate.toFixed(1)}% success rate`, color: sysColor },
  ];
  eKpis.forEach((k, i) => kpiCard(MG + i * (eW + 3), y, eW, k.label, k.value, k.sub, k.color));
  y += CARD_H + 6;

  if (errorLogs.length > 0 || secEvt.length > 0) {
    const combined = [...errorLogs, ...secEvt]
      .filter((v, i, a) => a.findIndex(x => x.log_id === v.log_id) === i)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);

    autoTable(doc, {
      startY: y,
      head: [['Timestamp','User','Type','Module','Detail']],
      body: combined.map(l => {
        const u = users.find(x => x.user_id === l.user_id);
        const moduleMatch = l.action.match(/^(?:ERROR|WARNING)\|([^:]+)/);
        const module = moduleMatch ? trunc(moduleMatch[1].replace(/_/g,' '), 18) : isSecurity(l.action) ? 'LOGIN' : '—';
        const detail = trunc(l.action.replace(/^(?:ERROR|WARNING)\|[^:]+:\s*/, ''), 50);
        return [
          new Date(l.timestamp).toLocaleString('en-US', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }),
          sanitize(u?.full_name || 'Unknown'),
          isError(l.action) ? 'ERROR' : isWarning(l.action) ? 'WARNING' : 'SECURITY',
          module,
          sanitize(detail),
        ];
      }),
      theme: 'plain',
      headStyles: { fillColor: [254,226,226] as RGB, textColor: [185,28,28] as RGB, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
      bodyStyles: { fontSize:6.5, cellPadding:2.5, font:'helvetica', textColor:[80,0,0] },
      columnStyles: { 0:{cellWidth:28}, 1:{cellWidth:32}, 2:{cellWidth:18}, 3:{cellWidth:30}, 4:{cellWidth:'auto'} },
      margin: { left: MG, right: MG },
      didParseCell: (d: any) => {
        if (d.section === 'body' && d.column.index === 2) {
          const v = String(d.cell.raw);
          d.cell.styles.textColor = v === 'ERROR' ? [185,28,28] : v === 'WARNING' ? [154,70,0] : [120,0,120];
          d.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
    if (errorLogs.length + secEvt.length > 20) {
      doc.setFontSize(6.5); setColor(...C.sub);
      txt(`* Showing 20 of ${errorLogs.length + secEvt.length} total events.`, MG, y); y += 6;
    }
  } else {
    fillRound(MG, y, CW, 12, [240,253,244] as RGB, [134,239,172] as RGB, 2.5);
    doc.setFontSize(8); doc.setFont('helvetica','bold'); setColor(...C.green);
    txt('✅  No errors, warnings, or security events detected.', MG + 6, y + 8); y += 18;
  }

  needsPage(14);
  const monthLabel = now.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  sectionLabel(`Monthly Activity — ${monthLabel}`, C.purple, `${monthStats.total} actions`);

  const avgPerUser = monthStats.uniqueUsers > 0 ? (monthStats.total / monthStats.uniqueUsers).toFixed(1) : '0';
  const topActionRaw  = monthStats.topActions[0]?.[0] || '—';
  const topActionFmt  = wrapEvery(topActionRaw, 15);
  const topActionCnt  = monthStats.topActions[0]?.[1] || 0;

  const mKpis = [
    { label:'Total Actions',  value: monthStats.total.toString(),       sub:'this month',          color: C.green,  multi: false },
    { label:'Active Users',   value: monthStats.uniqueUsers.toString(), sub:`of ${users.length}`,  color: C.blueL,  multi: false },
    { label:'Avg / User',     value: avgPerUser,                        sub:'actions per person',  color: C.purple, multi: false },
    { label:'Top Action',     value: topActionFmt,                      sub:`${topActionCnt}×`,    color: C.amber,  multi: true  },
  ];
  const mW = (CW - 9) / 4;
  mKpis.forEach((k, i) => {
    const fn = k.multi ? kpiCardMultiline : kpiCard;
    fn(MG + i * (mW + 3), y, mW, k.label, k.value, k.sub, k.color);
  });
  y += CARD_H + 6;

  if (monthStats.topActions.length) {
    doc.setFontSize(7); doc.setFont('helvetica','bold'); setColor(...C.mid);
    txt('Top Actions This Month', MG, y); y += 4;
    const maxAct = monthStats.topActions[0][1];
    monthStats.topActions.slice(0, 5).forEach(([action, count], i) => {
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); setColor(...C.mid);
      txt(`${i + 1}. ${trunc(action, 28)}`, MG, y + 4);
      doc.setFont('helvetica','bold'); setColor(...C.blueL);
      txt(`${count}  (${monthStats.total > 0 ? ((count/monthStats.total)*100).toFixed(1) : 0}%)`, MG + 90, y + 4);
      hBar(MG + 120, y - 1, CW - 126, 5, count / maxAct, C.blueL); y += 7;
    });
    y += 3;
  }

  if (monthLogs.length) {
    needsPage(14);
    const grouped: Record<string, Record<string, number>> = {};
    monthLogs.forEach(l => {
      const dk = new Date(l.timestamp).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' });
      const ak = trunc(l.action, 45);
      if (!grouped[dk]) grouped[dk] = {};
      grouped[dk][ak] = (grouped[dk][ak] || 0) + 1;
    });
    const tableBody: [string, string, string][] = [];
    Object.keys(grouped).sort().forEach(date => {
      Object.entries(grouped[date]).forEach(([action, count]) => tableBody.push([date, action, count.toString()]));
    });

    autoTable(doc, {
      startY: y,
      head: [['Date','Action','Count']],
      body: tableBody.slice(0, 30),
      theme: 'striped',
      headStyles: { fillColor: C.purple, textColor: C.white, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
      bodyStyles: { fontSize:6.5, cellPadding:2.5, font:'helvetica', textColor:[50,50,50] },
      columnStyles: { 0:{cellWidth:35}, 1:{cellWidth:'auto'}, 2:{cellWidth:20} },
      margin: { left: MG, right: MG },
      didParseCell: (d: any) => {
        if (d.section === 'body' && d.column.index === 1) {
          const v = String(d.cell.raw).toUpperCase();
          if (v.includes('DELETE') || v.includes('ERROR'))   d.cell.styles.textColor = [185,28,28];
          else if (v.includes('LOGIN_FAILED'))               d.cell.styles.textColor = [154,70,0];
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
    if (tableBody.length > 30) {
      doc.setFontSize(6.5); setColor(...C.sub);
      txt(`* ${tableBody.length - 30} additional entries omitted.`, MG, y); y += 6;
    }
  }

  needsPage(14);
  sectionLabel('User Roster', [50,50,70] as RGB, `${users.length} registered`);
  y += 4;

  [
    { label:`${roleCounts.admin} Admin`,  color: C.red   },
    { label:`${roleCounts.doctor} Doctor`, color: C.green },
    { label:`${roleCounts.staff} Staff`,  color: C.amber },
  ].forEach((b, i) => badge(MG + i * 38, y, b.label, b.color, C.white));
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['ID','Username','Full Name','Role','Actions','Last Active','Status']],
    body: users.map(u => {
      const ul = allLogs.filter(l => l.user_id === u.user_id);
      const last = ul.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      return [
        `#${u.user_id}`, sanitize(u.username), sanitize(u.full_name),
        u.role === 'admin' ? 'Admin' : u.role === 'doctor' ? 'Doctor' : 'Staff',
        ul.length.toString(),
        last ? new Date(last.timestamp).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'2-digit'}) : 'Never',
        ul.length === 0 ? 'Inactive' : 'Active',
      ];
    }),
    theme: 'striped',
    headStyles: { fillColor: [50,50,70] as RGB, textColor: C.white, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
    bodyStyles: { fontSize:7, cellPadding:3, font:'helvetica', textColor:[50,50,50] },
    columnStyles: { 0:{cellWidth:12}, 1:{cellWidth:30}, 2:{cellWidth:'auto'}, 3:{cellWidth:20}, 4:{cellWidth:20}, 5:{cellWidth:22}, 6:{cellWidth:16} },
    margin: { left: MG, right: MG },
    didParseCell: (d: any) => {
      if (d.section === 'body') {
        if (d.column.index === 3) {
          const v = String(d.cell.raw);
          d.cell.styles.textColor = v==='Admin' ? [185,28,28] : v==='Doctor' ? [21,128,61] : [154,100,0];
          d.cell.styles.fontStyle = 'bold';
        }
        if (d.column.index === 6) {
          d.cell.styles.textColor = String(d.cell.raw) === 'Active' ? [21,128,61] : [185,28,28];
          d.cell.styles.fontStyle = 'bold';
        }
        if (d.column.index === 4) {
          const v = parseInt(String(d.cell.raw));
          if (v === 0) d.cell.styles.textColor = [185,28,28];
          else if (v > 50) { d.cell.styles.textColor = [21,128,61]; d.cell.styles.fontStyle = 'bold'; }
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + GAP;

  doc.addPage(); y = TOP;
  pageStrip('INSIGHTS & ALERTS', genTime, C.blueL);

  sectionLabel('System Health Summary', sysColor);

  fillRound(MG, y, CW, 22, sysColor, undefined, 3);
  doc.setFontSize(11); doc.setFont('helvetica','bold'); setColor(...C.white);
  txt(`STATUS: ${sysStatus}`, MG + 7, y + 10);
  doc.setFontSize(7.5); doc.setFont('helvetica','normal'); setColor(230,240,255);
  const statusDesc =
    sysStatus === 'HEALTHY'          ? 'All indicators are within normal range. Continue regular monitoring.' :
    sysStatus === 'WARNING'          ? 'Some indicators are outside normal range. Review error logs and access patterns.' :
                                       'Critical indicators detected. Immediate review required.';
  txt(sanitize(statusDesc), MG + 7, y + 17); y += 28;

  const s8W = (CW - 9) / 4;
  const healthRow1 = [
    { label:'Total Activities', value: baseLogs.length.toString(),        sub:'all time',                color: C.blueL  },
    { label:'Success Rate',     value: `${successRate.toFixed(1)}%`,      sub:'non-failed',              color: successRate >= 90 ? C.green : C.red },
    { label:'Security Events',  value: failedCount.toString(),            sub:'failed logins',           color: failedCount > 0 ? C.red : C.green },
    { label:'Errors/Warnings',  value: errorLogs.length.toString(),       sub:'logged errors',           color: errorLogs.length > 0 ? C.red : C.green },
  ];
  const healthRow2 = [
    { label:'Activity Trend',   value: trendDir,                          sub:`${trendPct}% vs. day 1`,  color: trendColor },
    { label:'Monthly Total',    value: monthStats.total.toString(),       sub: monthLabel,               color: C.purple  },
    { label:'Peak Hour',        value: `${String(peakHour).padStart(2,'0')}:00`, sub:`${peakHourCount} actions`, color: C.amber   },
    { label:'Top Performer',    value: trunc(sanitize(topPerfs[0]?.name || 'N/A'), 14), sub:`${topPerfs[0]?.count || 0} actions`, color: C.purple },
  ];
  healthRow1.forEach((k, i) => kpiCard(MG + i * (s8W + 3), y, s8W, k.label, k.value, k.sub, k.color));
  y += CARD_H + 4;
  healthRow2.forEach((k, i) => kpiCard(MG + i * (s8W + 3), y, s8W, k.label, k.value, k.sub, k.color));
  y += CARD_H + GAP;

  sectionLabel('Insights & Recommendations', C.blueL);

  generateInsights().forEach((insight, i) => {
    needsPage(14);
    const isWarn = insight.includes('[WARNING]') || insight.toLowerCase().includes('failed');
    const isRec  = insight.toLowerCase().includes('recommend') || insight.toLowerCase().includes('review') || insight.toLowerCase().includes('verify');
    const bgColor:  RGB = isWarn ? [254,243,199] : isRec ? [239,246,255] : [248,250,252];
    const bdColor:  RGB = isWarn ? [253,230,138] : isRec ? [193,214,254] : [212,212,216];
    const txtColor: RGB = isWarn ? [120,53,15]   : isRec ? [30,64,175]   : [39,39,42];
    const tagColor: RGB = isWarn ? C.red         : isRec ? C.blueL       : C.green;
    const tag = isWarn ? 'WARN' : isRec ? 'ACTION' : 'INFO';

    const clean = sanitize(insight.replace('[WARNING]','').trim());
    const lines = doc.splitTextToSize(clean, CW - 28);
    const boxH  = Math.max(12, lines.length * 4.2 + 6);

    fillRound(MG, y, CW, boxH, bgColor, bdColor, 2.5);
    setFill(...tagColor); doc.circle(MG + 6, y + boxH / 2, 3.5, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica','bold'); setColor(...C.white);
    txt(`${i + 1}`, MG + 6, y + boxH / 2 + 2.2, { align:'center' });
    doc.setFontSize(6); setColor(...tagColor); txt(tag, MG + 13, y + 5.5);
    doc.setFontSize(7.5); doc.setFont('helvetica', isWarn ? 'bold' : 'normal'); setColor(...txtColor);
    doc.text(lines, MG + 13, y + 10);
    y += boxH + 3;
  });

  if (secEvt.length > 0) {
    needsPage(50); y += 4;
    fillRound(MG, y, CW, 11, [254,226,226] as RGB, [220,38,38] as RGB, 2.5);
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); setColor(185,28,28);
    txt(`SECURITY ALERT  —  ${secEvt.length} Failed Login Attempt${secEvt.length !== 1 ? 's' : ''} Detected`, MG + 5, y + 7.5); y += 16;

    autoTable(doc, {
      startY: y,
      head: [['Timestamp','User ID','Full Name','Action']],
      body: secEvt.slice(0, 15).map(l => {
        const u = users.find(x => x.user_id === l.user_id);
        return [
          new Date(l.timestamp).toLocaleString('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}),
          l.user_id.toString(), sanitize(u?.full_name || 'Unknown'), sanitize(l.action),
        ];
      }),
      theme: 'plain',
      headStyles: { fillColor: [254,226,226] as RGB, textColor: [185,28,28] as RGB, fontStyle:'bold', fontSize:7.5, font:'helvetica' },
      bodyStyles: { fontSize:7, cellPadding:2.8, textColor: [120,0,0] as RGB, font:'helvetica' },
      columnStyles: { 0:{cellWidth:30}, 1:{cellWidth:16}, 2:{cellWidth:38}, 3:{cellWidth:'auto'} },
      margin: { left: MG, right: MG },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
    if (secEvt.length > 15) {
      doc.setFontSize(7); setColor(...C.sub);
      txt(`* Showing 15 of ${secEvt.length} total events.`, MG, y); y += 6;
    }
  }

  needsPage(20); y += 6; rule(C.line, 0, 6);
  fillRound(MG, y, CW, 14, C.bg, C.line, 2.5);
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); setColor(...C.mid); txt('Report Certification', MG + 5, y + 5.5);
  doc.setFont('helvetica','normal'); setColor(...C.sub); doc.setFontSize(7);
  txt(`Automatically generated by StegoShield on ${genTime}. Confidential — authorised personnel only.`, MG + 5, y + 11);
  y += 18;

  stampFooters();

  const dateStr       = now.toISOString().split('T')[0];
  const userStr       = selectedUser ? `_user${selectedUser.user_id}` : '';
  const filterStr     = dateFilter   ? `_${dateFilter}` : '';
  doc.save(`stegoshield_report_${dateStr}${userStr}${filterStr}.pdf`);

  showNotification('Report exported successfully!', 'success');
};