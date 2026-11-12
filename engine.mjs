// All offsets are UTF-16 indices so a correction can be applied with String.slice.
const limits = { report: 24000, csv: 96000, rows: 500, columns: 32, segments: 300, segment: 1000 };
const columnNames = {
  metric: ['指标', '指标名', '指标名称', 'metric', 'indicator'],
  previous: ['上期', '上期值', '上周', '上月', '上季度', '上年', '上年同期', '去年同期', 'previous', 'prior'],
  current: ['本期', '本期值', '本周', '本月', '本季度', '本年', '当期', 'current'],
  unit: ['单位', '计量单位', 'unit'],
};

function readCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  function endField() { row.push(field.trim()); field = ''; closed = false; }
  function endRow() { endField(); rows.push(row); row = []; }
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (ch === ',') endField();
    else if (ch === '\n' || ch === '\r') { endRow(); if (ch === '\r' && text[i + 1] === '\n') i++; }
    else if (ch === '"' && !field && !closed) quoted = true;
    else if (ch === '"' || (closed && !/\s/u.test(ch))) throw Error('CSV 引号不完整，请用双引号包住含逗号的字段。');
    else field += ch;
  }
  if (quoted) throw Error('CSV 字段缺少结束双引号。');
  endRow();
  return rows;
}

const units = new Map();
function addUnit(name, dimension, scale = 1) { units.set(name, { name, dimension, scale }); }
addUnit('', 'number');
addUnit('%', 'percent');
addUnit('个百分点', 'point');
for (const base of ['元', '美元', '港元', '人', '户', '件', '个', '笔', '台', '单', '次', '辆', '份', '吨', '套', '家', '人次', '千瓦时']) {
  for (const [prefix, factor] of [['', 1], ['千', 1e3], ['万', 1e4], ['亿', 1e8]]) addUnit(prefix + base, base, factor);
}
for (const [name, dim, factor] of [
  ['人民币元', '元', 1], ['克', 'weight', 1], ['千克', 'weight', 1000], ['公斤', 'weight', 1000],
  ['吨', 'weight', 1e6], ['万吨', 'weight', 1e10], ['毫秒', 'time', 0.001], ['秒', 'time', 1],
  ['分钟', 'time', 60], ['小时', 'time', 3600], ['米', 'length', 1], ['厘米', 'length', .01],
  ['毫米', 'length', .001], ['千米', 'length', 1000], ['公里', 'length', 1000],
  ['万', 'number', 1e4], ['亿', 'number', 1e8], ['倍', 'multiple', 1],
]) addUnit(name, dim, factor);
const numberSource = '[+＋\\-−]?(?:\\d{1,3}(?:[,，]\\d{3})+|\\d+)(?:\\.\\d+)?';
const unitSource = [...units.keys()].filter(Boolean).sort((a, b) => b.length - a.length).concat(['％']).join('|');
const numberAndUnit = '(' + numberSource + ')(?:[ \\t]*(' + unitSource + '))?';
function normalizedUnit(name) { return name === '％' || name === '百分比' ? '%' : name; }
function numberValue(value) { return Number(value.replace(/[,，]/g, '').replace(/−/g, '-').replace(/＋/g, '+')); }
function sourceValue(raw, baseUnit) {
  if (baseUnit === '%' && raw.includes('/')) {
    const ratio = new RegExp('^(' + numberSource + ')\\s*/\\s*(' + numberSource + ')$', 'u').exec(raw);
    if (!ratio) return null;
    const numerator = numberValue(ratio[1]), denominator = numberValue(ratio[2]);
    if (denominator <= 0 || Math.max(Math.abs(numerator),denominator) > Number.MAX_SAFE_INTEGER) return null;
    const value = numerator / denominator * 100;
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? { value, unit:units.get('%'), ratio:true } : null;
  }
  const match = new RegExp('^' + numberAndUnit + '$', 'u').exec(raw);
  if (!match) return null;
  const unit = units.get(normalizedUnit(match[2] || baseUnit));
  if (!unit || (baseUnit && units.get(baseUnit)?.dimension !== unit.dimension)) return null;
  const value = numberValue(match[1]) * unit.scale;
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? { value, unit } : null;
}
function columnLetter(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function loadSource(csv, provided, result) {
  const records = readCSV(csv);
  const headerIndex = records.findIndex(row => row.some(Boolean));
  const headers = records[headerIndex];
  const rows = records.slice(headerIndex + 1);
  if (!headers?.length) throw Error('请提供含表头的 CSV。');
  if (headers.length > limits.columns) throw Error('CSV 最多支持 32 列，请保留与核对有关的列。');
  if (rows.filter(row => row.some(Boolean)).length > limits.rows) throw Error('CSV 最多支持 500 条数据，请分批核对。');
  result.headers = headers;
  if (new Set(headers).size !== headers.length) throw Error('CSV 中有同名列，请先改名。');
  const columns = {};
  const mappedIndices = new Set();
  for (const [key, aliases] of Object.entries(columnNames)) {
    const requested = provided?.[key];
    const index = requested ? headers.indexOf(requested) : headers.findIndex(h => aliases.includes(h.toLowerCase()));
    if (index < 0 && (key !== 'unit' || requested)) throw Error('找不到' + aliases[0] + '列，请检查列映射。');
    if (index >= 0 && mappedIndices.has(index)) throw Error('同一 CSV 列不能同时映射到两个字段。');
    if (index >= 0) mappedIndices.add(index);
    columns[key] = index;
    result.mapping[key] = headers[index] || '';
  }
  if (!rows.some(row => row.some(Boolean))) throw Error('CSV 只有表头，请添加指标数据。');
  const metrics = new Map();
  rows.forEach((fields, i) => {
    if (!fields.some(Boolean)) return;
    const row = headerIndex + i + 2;
    if (fields.length !== headers.length) throw Error('CSV 第 ' + row + ' 条记录列数与表头不一致。');
    const name = fields[columns.metric];
    if (!name) throw Error('CSV 第 ' + row + ' 条记录没有指标名。');
    const unit = normalizedUnit(fields[columns.unit] || '');
    const previous = sourceValue(fields[columns.previous], unit);
    const current = sourceValue(fields[columns.current], unit);
    const show = (key) => {
      const raw = fields[columns[key]];
      const parsed = key === 'previous' ? previous : current;
      const label = parsed?.ratio ? '（' + format(parsed.value) + '%）' : unit && new RegExp('^' + numberSource + '$').test(raw) ? unit : '';
      return columnLetter(columns[key]) + row + '（' + headers[columns[key]] + '）= ' + (raw || '空值') + label;
    };
    const entry = { name, previous, current, evidence: name + '：' + show('previous') + '；' + show('current') };
    if (metrics.has(name)) { const other = metrics.get(name); other.duplicate = true; other.evidence += '；另见第 ' + row + ' 条记录'; }
    else metrics.set(name, entry);
  });
  result.metrics = [...metrics.keys()];
  return metrics;
}

const decimalFormat = new Intl.NumberFormat('en-US', { useGrouping:false, maximumSignificantDigits:16 });
const format = n => Number.isInteger(n) ? String(n) : decimalFormat.format(n);
const same = (a, b) => (Number.isInteger(a) && Number.isInteger(b)) ? a === b : Math.abs(a - b) <= 4 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
const review = reason => ({ status: 'review', formula: reason, replacements: [] });
const unsupported = /目标|计划|预计|预测|争取|假设|如果|假如|截至|累计|分别|平均|中位数|中位|占比为其|其中占|预算|应为|不少于|不超过|至少|至多|以上|以下|超过|超出|不足|不到|大于|小于|多于|少于|对比同行|行业|竞争对手|友商|去年全年|去年底|接近|翻番|翻倍|高于|低于|优于|劣于|不及|介于|落在|保持在|区间|波动|持平|未达|不到|不含|舍去|仅限|占到|占据|占了|占比达|没有|并未|未能|不再|未曾|原本|此前预计|约为其|[<>≤≥～~]|[\d%％]\s*[-—–至]\s*\d+(?:\.\d+)?[%％]\s*(?:之间|区间)/u;
const growthWord = /(增幅|涨幅|降幅|跌幅|增速|增量|增加|减少|增长|上涨|下降|下跌|降低|回落|下滑|提升|提高|上升|扩大|缩小|多出|少了|变动|变化)(?:率|幅度)?(?:约为|约|达到|为|了|是|达)?\s*$/u;
const downward = /降|跌|减少|回落|下滑|缩小|少了/u;
const neutralChange = /变化|变动/u;
const endpoints = /(升至|升到|增至|增到|增长至|增长到|增加至|增加到|提高到|提高至|提升到|提升至|涨至|涨到|降至|降到|下降到|下降至|降为|减少到|减少至|跌至|跌到|变为|变成|变至|达到|达到了|达到约|至|到)\s*(?:本期|本周|本月|本季度|本年)?(?:为|的|约)?\s*$/u;
// Verify who and what a number describes before borrowing a metric from an earlier clause.
const prefixToken = /(?:指标|本期|当期|本月|本季度|上期|上月|上季度|去年同期|同期|上周|本周|上年|本年|当前|前期|基期|由|从|到|至|原先|原来|已|则|其中|约|大约|约为|为|是|的|达|达到|实际|分别|较|相较|相比|比|与|和|相比于|环比|同比|据统计|数据显示|总计|合计|[：:\s])/uy;
function isSimplePrefix(value) {
  // Consume recognized words once; a malformed long suffix must never induce regex backtracking.
  prefixToken.lastIndex = 0;
  while (prefixToken.lastIndex < value.length) {
    if (!prefixToken.test(value)) return false;
  }
  return true;
}
const pastWord = /上期|上周|上月|上季度|上年|前一期|前期|基期|去年同期/u;
const currentWord = /本期|当期|本周|本月|本季度|本年|当前/u;
const numberRegex = () => new RegExp(numberAndUnit, 'gu');
function agreement(actual, expected, token, allowRounded) {
  if (same(actual, expected)) return true;
  if (!allowRounded) return false;
  const decimals = token.split('.')[1]?.length || 0;
  if (expected !== 0 && actual === 0) return false; // Don't certify "0%" for a small nonzero change.
  return same(Number(expected.toFixed(Math.min(decimals, 12))), actual);
}
function classifyClaim(body, q, prevEnd, entry) {
  const pre = body.slice(prevEnd, q.index);
  const clausePrefix = pre.split(/[，,、]/u).pop().trim();
  const post = body.slice(q.end);
  const value = numberValue(q.number);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return review('数值超出可安全比较的范围。');
  if (/^\s*(?:[\/／:：~～—–]|倍|成|余|多|左右|以上|以下|以内|以外|每|\/)/u.test(post)) return review('该数值有额外的换算、区间或比较口径。');
  // The metric name may itself contain a direction word, e.g. "营收增长率".
  const context = clausePrefix.replaceAll(entry.name, '指标');
  const end = context.match(endpoints);
  const change = !end && context.match(growthWord);
  const predicate = end || change;
  if (!isSimplePrefix(predicate ? context.slice(0,predicate.index) : context)) return review('数值前含有未识别的指标、限定条件或比较口径。');
  if (!q.unit && /^[\p{L}]/u.test(post) && !/^[至到]/u.test(post)) return review('该数值可能带有不支持的单位。');
  if (/^\s*(?:人民币以外|[万亿千百]?[美港欧日]元|人民币|美金|[二三四五六七八九十百千万亿]成|[十百千万亿]余)/u.test(post)) return review('该数字还带有其他单位或换算条件。');
  const p = entry.previous.value, c = entry.current.value;
  const dim = entry.current.unit.dimension;
  const unit = units.get(normalizedUnit(q.unit));
  if (!unit) return review('没有识别数字单位。');
  const absoluteText = (amount, u) => format(amount / u.scale) + u.name;
  const firstCur = absoluteText(c, entry.current.unit), firstPrev = absoluteText(p, entry.previous.unit);
  let expected, formula, allowRounded = false, alternate;
  if (change) {
    const word = change[1];
    const direction = downward.test(word) ? -1 : 1;
    const neutral = neutralChange.test(word);
    let delta = neutral ? c - p : direction * (c - p);
    const requestedDim = unit.dimension;
    if (/(率|增幅|降幅|涨幅|跌幅|增速)/u.test(change[0]) && requestedDim !== 'percent') return review('增长率与变化幅度的单位需要核实。');
    if (!q.unit && dim !== 'number') return review('稿件数值缺少单位。');
    if (requestedDim === 'percent') {
      if (p <= 0) return review('上期数值为零或负数，不能按普通增长率核对。');
      expected = delta / p * 100;
      formula = '(' + (direction < 0 && !neutral ? firstPrev + ' − ' + firstCur : firstCur + ' − ' + firstPrev) + ') ÷ ' + firstPrev + ' × 100% = ' + format(expected) + '%';
      allowRounded = true;
      if (dim === 'percent' && !neutral && !/(率|幅|增速)/u.test(change[0]) && same(value,delta)) alternate = format(delta) + '个百分点';
    } else if (requestedDim === 'point' && dim === 'percent') {
      expected = delta;
      formula = firstCur + ' 与 ' + firstPrev + ' 相差 ' + format(Math.abs(c - p)) + ' 个百分点';
      if (p > 0 && !neutral && same(value,delta / p * 100)) alternate = format(delta / p * 100) + '%';
    } else if (requestedDim === dim && requestedDim !== 'percent') {
      expected = delta / unit.scale;
      formula = firstCur + ' 与 ' + firstPrev + ' 相差 ' + absoluteText(Math.abs(c - p), unit);
    } else return review('变化量和源表指标的单位不能直接比较。');
    if (!neutral && (delta < 0 || value < 0)) {
      return { status: 'issue', formula: '稿件的变化方向或正负号需核实；上期 ' + firstPrev + '，本期 ' + firstCur + '。', replacements: [] };
    }
  } else {
    let period;
    if (end) period = 'current';
    else if (/(?:从|由|自)(?:约|原先的|原来的)?\s*$/u.test(context) || (pastWord.test(context) && !currentWord.test(context))) period = 'previous';
    else if (currentWord.test(context) && !pastWord.test(context)) period = 'current';
    else if (/^(?:指标)(?:约为|为|是|达|约|：|:)\s*$/u.test(context)) period = 'current';
    else return review('无法确定该数字指本期、上期还是变化量。');
    if (!q.unit && dim !== 'number') return review('稿件数值缺少单位。');
    if (unit.dimension !== dim) return review('稿件单位和源表指标单位不一致。');
    if (end && (/降|跌|减少/u.test(end[1]) ? c > p : /升|增|提高|提升|涨/u.test(end[1]) && c < p)) {
      return {status: 'issue', formula: '稿件的变化方向与源表两期数值相反。', replacements: []};
    }
    const ref = entry[period];
    expected = ref.value / unit.scale;
    allowRounded = /约/u.test(context);
    formula = (period === 'previous' ? '上期' : '本期') + ' ' + absoluteText(ref.value, ref.unit) + ' = ' + format(expected) + unit.name;
  }
  if (agreement(value, expected, q.number, allowRounded)) return {status:'ok',formula,replacements:[]};
  const proposed = format(expected) + q.unit;
  return { status:'issue', formula, replacements:[proposed, ...(alternate ? [alternate] : [])] };
}

function verifySegment(body, start, metrics, mapping) {
  const finding = {status:'review', original:body, start, end:start+body.length, evidence:'', formula:'', suggestions:[]};
  function hold(reason) { finding.formula = reason; return finding; }
  if (body.length > limits.segment) return hold('单个句段超过 1,000 个字符，请拆句后核对。');
  const names = [...metrics.keys()].filter(k => body.includes(k)).sort((a,b) => b.length-a.length);
  const unique = names.filter((k,i) => !names.slice(0,i).some(longer => longer.includes(k) && !body.replaceAll(longer,'').includes(k)));
  if (unique.length !== 1) return hold(unique.length ? '句中涉及多个指标，请拆开陈述后核对。' : '源表中找不到与这句话明确对应的指标。');
  const entry = metrics.get(unique[0]);
  finding.evidence = entry.evidence;
  if (entry.duplicate) return hold('源表有同名指标，请明确对应哪一行。');
  if (!entry.previous || !entry.current || entry.previous.unit.dimension !== entry.current.unit.dimension) return hold('源表含缺失值、无法解析的数值或不一致的单位。');
  const prefix = body.slice(0,body.indexOf(entry.name)).split(/[，,：:]/u).pop().trim();
  if (/[\p{L}]/u.test(prefix.replace(/本期|上期|本周|上周|本月|上月|本季度|上季度|上年同期|上年|本年|当期|前期|当前|数据显示|其中|而|该|我们的|公司|环比|同比|去年同期|月报|周报|据统计/gu,''))) return hold('指标名称或统计范围可能与源表不完全相同。');
  if (unsupported.test(body)) return hold('稿件涉及目标、预测、区间、累计或其他比较口径，需人工确认。');
  if ((/同比|去年同期|上年同期/u.test(body) && !/去年同期|上年同期/u.test(mapping.previous))
      || (/环比/u.test(body) && !/^(?:上期(?:值)?|上月|上季度|上周|上年|previous|prior)$/iu.test(mapping.previous))) return hold('源表列未明确证明稿件指定的同比或环比周期。');
  for (const [terms, header] of [[/本周|上周/u,'周'], [/本月|上月/u,'月'], [/本季度|上季度/u,'季']]) {
    if (terms.test(body) && !mapping.previous.includes(header) && !mapping.current.includes(header)) return hold('稿件指定了统计周期，源表列没有对应周期。');
  }
  const checks = [];
  let prevEnd = 0;
  const nameRanges = [];
  for (let at=body.indexOf(entry.name); at>=0; at=body.indexOf(entry.name, at+entry.name.length)) nameRanges.push([at,at+entry.name.length]);
  for (const match of body.matchAll(numberRegex())) {
    const index = match.index, end = index + match[0].length;
    if (nameRanges.some(([a,b])=>index>=a && end<=b)) continue;
    const q = { index, end, number: match[1], unit: match[2] || '' };
    const check = classifyClaim(body, q, prevEnd, entry);
    checks.push({...q,...check});
    prevEnd = end;
  }
  if (!checks.length) return hold('没有可按源表直接计算的阿拉伯数字。');
  finding.formula = [...new Set(checks.map(c=>c.formula))].join('；');
  const issues = checks.filter(c=>c.status==='issue');
  if (checks.some(c=>c.status==='review')) return finding;
  finding.status = issues.length ? 'issue' : 'ok';
  if (issues.length && issues.every(c=>c.replacements.length)) {
    function corrected(alternateIndex = -1) {
      let draft = body;
      for (let i=issues.length-1; i>=0; i--) {
        const c = issues[i];
        draft = draft.slice(0,c.index) + c.replacements[i===alternateIndex ? 1 : 0] + draft.slice(c.end);
      }
      return draft;
    }
    finding.suggestions = [corrected(), ...issues.flatMap((v,i)=>v.replacements.length>1?[corrected(i)]:[])];
  }
  return finding;
}

/** Compare a Chinese report with a two-period source CSV. Does not mutate either input. */
export function audit(report, csv, mapping = {}) {
  const result = { findings:[], errors:[], headers:[], mapping:{}, metrics:[], summary:{issue:0,ok:0,review:0} };
  if (typeof report !== 'string' || !report.trim()) result.errors.push('请填写待核对的稿件。');
  if (typeof csv !== 'string') { result.errors.push('请提供 CSV 文本。'); return result; }
  if (typeof report === 'string' && report.length > limits.report) result.errors.push('稿件最多支持 24,000 个字符，请分段核对。');
  if (csv.length > limits.csv) result.errors.push('CSV 最多支持 96,000 个字符，请分批核对。');
  if (result.errors.length) return result;
  let metrics;
  try { metrics = loadSource(csv,mapping,result); }
  catch (error) { result.errors.push(error.message); return result; }
  const segments = [];
  for (const match of report.matchAll(/[^\n\r。！？!?；;]+/gu)) {
    const body = match[0].trim();
    if (!/\d|百分之|个百分点|[零一二三四五六七八九十百千万亿两半]+(?:成|倍|元|人|件|笔|单|万|亿)|翻倍|翻番/u.test(body)) continue;
    const start = match.index + match[0].indexOf(body);
    segments.push({ body, start });
    if (segments.length > limits.segments) {
      result.errors.push('稿件最多支持 300 个含数字的句段，请分段核对。');
      return result;
    }
  }
  for (const {body,start} of segments) {
    const finding = verifySegment(body,start,metrics,result.mapping);
    result.findings.push(finding);
    result.summary[finding.status]++;
  }
  return result;
}
