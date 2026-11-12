import { audit } from './engine.mjs';

const byId = (id) => document.getElementById(id);
const demoReport = '# 本周运营周报\n\n转化率从4%升至5%，提升了1%。\n\n本期销售额为15万元。\n\n客单价增长了8%。';
const demoCsv = '指标,上期,本期,单位\n转化率,40/1000,50/1000,%\n销售额,12,15,万元';
const fields = ['metric', 'previous', 'current', 'unit'];
const storageKey = 'dsh-number-proof.column-names.v1';
const tags = { issue: '发现差异', ok: '数值一致', review: '待人工核对' };
const statuses = ['issue', 'ok', 'review'];
const files = { report: '', csv: '' };
const reads = { report: 0, csv: 0 };
const decisions = new Map();
let snapshot = null;
let selected = 0;
let isDemo = true;
let importedReport = null;

function element(name, className, value) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function action(label, className, handler) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function textValue(value) {
  return typeof value === 'string' ? value : value?.message || '';
}

function notify(message = '', kind = 'info') {
  const notice = byId('notice');
  notice.hidden = !message;
  notice.textContent = message;
  notice.dataset.kind = kind;
}

function readMapping() {
  return Object.fromEntries(fields.map((key) => [key, byId('field-' + key).value.trim()]).filter(([, v]) => v));
}

function fillMapping(values = {}) {
  for (const key of fields) byId('field-' + key).value = typeof values?.[key] === 'string' ? values[key] : '';
}

function restoreMapping() {
  try { fillMapping(JSON.parse(localStorage.getItem(storageKey) || '{}')); }
  catch { fillMapping(); }
}

function currentSource() {
  return { report: importedReport ?? byId('report-input').value, csv: byId('csv-input').value, mapping: JSON.stringify(readMapping()) };
}

function isFresh() {
  if (!snapshot) return false;
  const current = currentSource();
  return current.report === snapshot.report && current.csv === snapshot.csv && current.mapping === snapshot.mapping;
}

function acceptedEntries() {
  if (!snapshot) return [];
  return [...decisions.entries()].filter(([, decision]) => decision.kind === 'accepted')
    .map(([id, decision]) => ({ finding: snapshot.findings[id], text: decision.text }))
    .sort((a, b) => a.finding.start - b.finding.start);
}

function updateSources() {
  for (const key of ['report', 'csv']) {
    byId(key + '-name').textContent = files[key] || (isDemo ? (key === 'report' ? '演示周报.md' : '演示指标.csv') : '手动输入');
    const value = byId(key + '-input').value;
    byId(key + '-size').textContent = value ? value.split('\n').length + ' 行' : '0 行';
  }
  byId('project-label').textContent = isDemo ? '演示周报 · 示例材料' : files.report || '我的报告';
  byId('overview-action').replaceChildren(document.createTextNode(isDemo ? '导入我的材料 ' : '编辑原始材料 '), element('span', '', '↗'));
  byId('overview-action').lastChild.setAttribute('aria-hidden', 'true');
  byId('changes-count').textContent = isFresh() ? acceptedEntries().length : '0';
}

function go(tab, clearNotice = true) {
  const tabs = document.querySelectorAll('.tab');
  for (const btn of tabs) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
    byId('pane-' + btn.dataset.tab).hidden = !active;
  }
  if (clearNotice) notify();
  updateSources();
  if (tab === 'results') renderResults();
  if (tab === 'preview') renderPreview();
}

function showSource() {
  go('sources');
  byId('report-input').focus();
}

function startOwn() {
  if (isDemo && !decisions.size) {
    reads.report++; reads.csv++;
    byId('report-input').value = '';
    importedReport = null;
    byId('csv-input').value = '';
    files.report = ''; files.csv = '';
    isDemo = false;
    restoreMapping();
  }
  showSource();
}

function runAudit() {
  const current = currentSource();
  if (!current.report.trim() || !current.csv.trim()) {
    go('sources');
    notify('请先填写报告原稿和带表头的 CSV。', 'error');
    byId(current.report.trim() ? 'csv-input' : 'report-input').focus();
    return;
  }
  const mapping = readMapping();
  let result;
  try {
    result = audit(current.report, current.csv, Object.keys(mapping).length ? mapping : undefined);
  } catch (error) {
    go('sources');
    notify('核验未完成：' + (textValue(error) || '请检查材料格式。'), 'error');
    return;
  }
  if (result.errors?.length) {
    go('sources');
    notify(result.errors.map(textValue).filter(Boolean).join('；') || '请检查 CSV 表头和数据格式。', 'error');
    return;
  }
  const hadSameInputs = isFresh();
  snapshot = { ...current, findings: result.findings || [] };
  if (!hadSameInputs) { decisions.clear(); selected = 0; }
  go('results');
}

function loadDemo() {
  reads.report++; reads.csv++;
  files.report = ''; files.csv = '';
  importedReport = null;
  isDemo = true;
  snapshot = null; selected = 0; decisions.clear();
  byId('report-input').value = demoReport;
  byId('csv-input').value = demoCsv;
  fillMapping();
  runAudit();
}

function decisionBadge(id) {
  const kind = decisions.get(id)?.kind;
  return kind === 'accepted' ? ['accepted', '已采纳'] : kind === 'kept' ? ['kept', '已保留'] : null;
}

function sourceLine(finding) {
  return '行 ' + snapshot.report.slice(0, finding.start).split('\n').length;
}

function resultStats(findings, ready) {
  const stats = byId('stats');
  stats.replaceChildren();
  for (const status of statuses) {
    const title = element('span', 'stat-title');
    title.append(element('i', 'status-dot ' + status), document.createTextNode(tags[status]));
    const card = element('div', 'stat');
    card.append(title, element('span', 'stat-value', ready ? String(findings.filter(f => f.status === status).length).padStart(2, '0') : '—'));
    stats.append(card);
  }
}

function emptyState(title, detail, button, handler) {
  const box = element('div', 'empty-state');
  box.append(element('h2', '', title), element('p', '', detail));
  if (button) box.append(action(button, 'btn', handler));
  return box;
}

function renderResults() {
  const view = byId('results-view');
  view.replaceChildren();
  const ready = isFresh();
  const findings = snapshot?.findings || [];
  resultStats(findings, ready);
  if (!ready) {
    view.append(emptyState(snapshot ? '材料已变更' : '等待核验', '在“原稿与数据”中准备材料，然后开始核验。', '打开原稿与数据', showSource));
    return;
  }
  if (!findings.length) {
    view.append(emptyState('未找到可核验的表述', '请使用包含指标名称和数值的句子，并检查 CSV 中的指标名称。', '检查原始材料', showSource));
    return;
  }
  const grid = element('div', 'result-grid');
  const listPanel = element('div', 'panel');
  const title = element('div', 'panel-title');
  title.append(element('h3', '', '报告中的表述'), element('span', 'list-count', findings.length + ' 条'));
  const list = element('div', 'finding-list');
  const detail = element('div', 'panel detail');
  detail.id = 'finding-detail';
  let listButtons = [];
  function focusFinding(id, moveToDetail) {
    selected = id;
    for (let i = 0; i < listButtons.length; i++) {
      listButtons[i].classList.toggle('selected', i === id);
      listButtons[i].setAttribute('aria-pressed', String(i === id));
    }
    populateDetail(detail, id);
    if (moveToDetail && window.matchMedia('(max-width: 600px)').matches) {
      detail.scrollIntoView({ block: 'nearest' });
      detail.tabIndex = -1;
      detail.focus({ preventScroll: true });
    }
  }
  listButtons = findings.map((f, id) => {
    const button = action('', 'finding', () => focusFinding(id, true));
    button.setAttribute('aria-controls', 'finding-detail');
    const meta = element('div', 'finding-meta');
    const [kind, name] = decisionBadge(id) || [f.status, tags[f.status] || tags.review];
    meta.append(element('span', 'badge ' + kind, name), element('span', 'line-ref', sourceLine(f)));
    button.append(meta, element('span', 'finding-text', f.original));
    list.append(button);
    return button;
  });
  listPanel.append(title, list); grid.append(listPanel, detail); view.append(grid);
  focusFinding(Math.min(selected, findings.length - 1), false);
}

function fact(title, value, className) {
  const section = element('div', 'fact-block');
  section.append(element('h3', '', title), element('p', className, value));
  return section;
}

function validRange(f) {
  return Number.isInteger(f.start) && Number.isInteger(f.end) && f.start >= 0 && f.end > f.start &&
    f.end <= snapshot.report.length && snapshot.report.slice(f.start, f.end) === f.original;
}

function setDecision(id, decision) {
  if (decision?.kind === 'accepted') {
    const chosen = snapshot.findings[id];
    if (!validRange(chosen)) {
      notify('这段文字无法对应到原稿。请检查原稿后重新核验。', 'error');
      return;
    }
    const overlap = [...decisions.entries()].some(([otherId, choice]) => {
      const other = snapshot.findings[otherId];
      return otherId !== id && choice.kind === 'accepted' && chosen.start < other.end && other.start < chosen.end;
    });
    if (overlap) { notify('该处与另一条已采纳的修订重叠，请先撤销那条修订。', 'error'); return; }
  }
  if (decision) decisions.set(id, decision); else decisions.delete(id);
  renderResults(); updateSources();
  notify(decision?.kind === 'accepted' ? '已加入修订稿，原稿保持原样。' : decision ? '此处将保留原文。' : '已撤销处理，可重新选择。');
  const focus = byId('finding-detail')?.querySelector('.detail-actions button');
  focus?.focus({ preventScroll: true });
}

function populateDetail(detail, id) {
  const f = snapshot.findings[id], choice = decisions.get(id);
  detail.replaceChildren();
  const meta = element('div', 'detail-meta');
  meta.append(element('span', 'badge ' + f.status, tags[f.status] || tags.review), element('span', 'line-ref', sourceLine(f) + ' / 原文'));
  detail.append(meta, element('h2', '', '核验明细'), element('blockquote', 'quote', f.original));
  if (f.evidence) detail.append(fact('核验依据', textValue(f.evidence), 'evidence'));
  if (f.formula) detail.append(fact(f.status === 'review' ? '待核对原因' : '计算过程', textValue(f.formula), 'formula'));
  const actions = element('div', 'detail-actions');
  const suggestions = Array.isArray(f.suggestions) ? f.suggestions.filter(s => typeof s === 'string' && s !== f.original) : [];
  if (choice) {
    detail.append(element('p', 'decision', choice.kind === 'accepted' ? '已采纳：' + choice.text : '已确认保留原文。'));
    actions.append(action('撤销处理', 'btn', () => setDecision(id, null)), action('查看修订稿 →', 'btn', () => go('preview')));
  } else if (suggestions.length > 0 && validRange(f)) {
    const group = element('div', 'choices');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', '选择修订建议');
    group.append(element('h3', 'choice-title', '选择修订建议'));
    let proposed = suggestions[0];
    suggestions.forEach((suggestion, index) => {
      const label = element('label', 'choice');
      const input = element('input');
      input.type = 'radio'; input.name = 'suggestion'; input.checked = index === 0;
      input.addEventListener('change', () => { proposed = suggestion; });
      label.append(input, element('span', '', suggestion)); group.append(label);
    });
    detail.append(group);
    actions.append(action('采纳所选建议', 'btn primary', () => setDecision(id, { kind: 'accepted', text: proposed })), action('保留原文', 'btn', () => setDecision(id, { kind: 'kept' })));
  } else if (f.status !== 'ok') {
    actions.append(action('确认保留原文', 'btn', () => setDecision(id, { kind: 'kept' })), action('查看数据来源', 'btn', showSource));
  } else {
    actions.append(action('查看数据来源', 'btn', showSource));
  }
  detail.append(actions);
}

function buildPreview() {
  const parts = [], changes = acceptedEntries();
  let offset = 0;
  for (const { finding, text } of changes) {
    parts.push({ value: snapshot.report.slice(offset, finding.start) }, { value: text, changed: true });
    offset = finding.end;
  }
  parts.push({ value: snapshot.report.slice(offset) });
  return parts;
}

function renderPreview() {
  const fresh = isFresh();
  const count = fresh ? acceptedEntries().length : 0;
  byId('export-md').disabled = !fresh;
  byId('original-preview').textContent = byId('report-input').value || '暂无原稿。';
  byId('revised-preview').replaceChildren();
  byId('preview-caption').textContent = fresh ? '已采纳 ' + count + ' 处修订，其余内容保留原文。' : '请先核验当前材料，再生成修订稿。';
  if (!fresh) { byId('revised-preview').textContent = '等待核验。'; return; }
  for (const part of buildPreview()) {
    byId('revised-preview').append(part.changed ? element('mark', '', part.value) : document.createTextNode(part.value));
  }
}

function download() {
  if (!isFresh()) { go('sources'); notify('材料已改变，请重新核验。', 'error'); return; }
  const content = buildPreview().map(part => part.value).join('');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = element('a');
  link.href = url;
  const name = (files.report || (isDemo ? '演示周报' : '周报')).replace(/\.(md|markdown|txt)$/i, '');
  link.download = name + '-修订稿.md';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify('已生成 Markdown 修订稿。');
}

function markEdited(key) {
  if (isDemo && (key === 'report' || key === 'csv') && !Object.keys(readMapping()).length) restoreMapping();
  if (key === 'report') importedReport = null;
  if (key === 'report' || key === 'csv') files[key] = '';
  isDemo = false;
  updateSources();
  notify();
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => go(tab.dataset.tab));
for (const key of fields) byId('field-' + key).addEventListener('input', () => markEdited('mapping'));
for (const key of ['report', 'csv']) {
  byId(key + '-input').addEventListener('input', () => { reads[key]++; markEdited(key); });
  byId('pick-' + key).addEventListener('click', () => byId(key + '-file').click());
  byId(key + '-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++reads[key];
    try {
      const content = new TextDecoder('utf-8', {ignoreBOM: key === 'report'}).decode(await file.arrayBuffer());
      if (revision !== reads[key]) return;
      byId(key + '-input').value = content;
      markEdited(key);
      if (key === 'report') importedReport = content;
      files[key] = file.name; updateSources();
    } catch { if (revision === reads[key]) notify('无法读取该文件，请重新选择或粘贴文本。', 'error'); }
  });
}
byId('overview-action').addEventListener('click', () => { if (isDemo) startOwn(); else showSource(); });
byId('save-mapping').addEventListener('click', () => {
  try { localStorage.setItem(storageKey, JSON.stringify(readMapping())); notify('已记住列名设置。'); }
  catch { notify('当前环境不允许保存；本次仍可使用这些列名。'); }
});
byId('run-audit').addEventListener('click', runAudit);
byId('export-md').addEventListener('click', download);
byId('load-demo').addEventListener('click', () => {
  const hasMaterials = byId('report-input').value || byId('csv-input').value || decisions.size;
  if ((!isDemo || decisions.size > 0) && hasMaterials) {
    byId('demo-dialog').returnValue = '';
    byId('demo-dialog').showModal();
  }
  else loadDemo();
});
byId('demo-dialog').addEventListener('close', () => { if (byId('demo-dialog').returnValue === 'load') loadDemo(); });
loadDemo();
