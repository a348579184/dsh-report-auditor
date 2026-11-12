import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from './engine.mjs';

const base = '指标,上期,本期,单位\n转化率,4,5,%\n销售额,12,15,万元';
function finding(sentence, csv = base, mapping) {
  const result = audit(sentence, csv, mapping);
  assert.deepEqual(result.errors, []);
  assert.equal(result.findings.length, 1, sentence);
  return result.findings[0];
}

test('相对增长率与百分点分别给出可直接替换的修订，并保留原文偏移', () => {
  const text = '🔎\n  转化率从4%升至5%，提升了1%。\n本期销售额为15万元。\n客单价增长了8%。';
  const result = audit(text, base);
  assert.deepEqual(result.summary, { issue:1, ok:1, review:1 });
  const f = result.findings[0];
  assert.equal(text.slice(f.start, f.end), f.original);
  assert.match(f.evidence, /B2（上期）= 4%/);
  assert.match(f.formula, /× 100% = 25%/);
  assert.deepEqual(f.suggestions, ['转化率从4%升至5%，提升了25%', '转化率从4%升至5%，提升了1个百分点']);
  for (const replacement of f.suggestions) {
    const fixed = text.slice(0, f.start) + replacement + text.slice(f.end);
    assert.equal(audit(fixed, base).findings[0].status, 'ok');
  }
});

test('同维度金额单位换算，单位不兼容时留待复核', () => {
  assert.equal(finding('本期销售额为150,000元').status, 'ok');
  assert.equal(finding('本期销售额为1.5万元').suggestions[0], '本期销售额为15万元');
  assert.equal(finding('销售额增加了30,000元').status, 'ok');
  assert.equal(finding('销售额增长25%').status, 'ok');
  assert.equal(finding('销售额增加了3个百分点').status, 'review');
  assert.equal(finding('本期销售额为15万美元').status, 'review');
  assert.equal(finding('本期销售额为15').status, 'review');
});

test('期初、期末、绝对增减与负向相对变化', () => {
  const csv = '指标,上期,本期,单位\n退款率,5,4,%';
  assert.equal(finding('退款率从上期的5%下降到本期的4%，降低了1个百分点',csv).status, 'ok');
  assert.equal(finding('退款率降低了20%',csv).status, 'ok');
  assert.equal(finding('退款率下滑了1%',csv).status, 'issue');
  assert.equal(finding('退款率从5%升至4%',csv).status, 'issue');
  assert.deepEqual(finding('退款率上涨了20%',csv).suggestions, []);
  assert.equal(finding('上期退款率为5%',csv).status, 'ok');
});

test('无数据、零/负基数、同名、多指标和不明确周期不自动订正', () => {
  const cases = [
    ['客单价增长8%', base],
    ['转化率同比增长25%', base],
    ['转化率提升了25%', '指标,上期,本期,单位\n转化率,0,5,%'],
    ['销售额增长25%', '指标,上期,本期,单位\n销售额,-12,-9,万元'],
    ['转化率提升25%', base + '\n转化率,5,6,%'],
    ['转化率提升25%', '指标,上期,本期,单位\n转化率,N/A,5,%'],
    ['销售额和转化率增长25%', base],
    ['预计本期销售额为15万元', base],
    ['本期销售额高于15万元', base],
    ['新客转化率增长了25%', base],
    ['本期销售额为15万元，净利润增长25%', base],
    ['转化率增长一成', base],
  ];
  for (const [sentence,csv] of cases) {
    const f = finding(sentence, csv);
    assert.equal(f.status, 'review', sentence);
    assert.deepEqual(f.suggestions, [], sentence);
  }
});

test('校对数值来自用户指定列，支持 BOM、引号及各单元格自带单位', () => {
  const csv = '\uFEFF名称,基线,结果,备注\r\n\r\n月销售额,"120,000元",15万元,"备注,含逗号"';
  const f = finding('本期月销售额为150000元', csv, { metric:'名称',previous:'基线',current:'结果' });
  assert.equal(f.status, 'ok'); assert.match(f.evidence,/B3/);
  assert.equal(finding('转化率同比增长25%', '指标,去年同期,本期,单位\n转化率,4,5,%').status, 'ok');
  assert.ok(audit('本期销售额为15万元',base,{previous:'不存在'}).errors.length);
  assert.ok(audit('本期销售额为15万元',base,{previous:'本期'}).errors.length);
  assert.ok(audit('本期销售额为15万元','指标,上期,本期\n销售额,"12,15').errors.length);
  assert.ok(audit('本期销售额为15万元','指标,上期,本期\n销售额,15').errors.length);
});

test('比较时不宽容大金额的真实错差，接受常规四舍五入的变化率', () => {
  assert.equal(finding('本期销售额为100000000001元','指标,上期,本期,单位\n销售额,90000000000,100000000000,元').status,'issue');
  assert.equal(finding('销售额增长33.3%', '指标,上期,本期,单位\n销售额,3,4,万元').status,'ok');
  assert.equal(finding('销售额增长33.3%', '指标,上期,本期,单位\n销售额,3,4.1,万元').status,'issue');
});

test('上期是紧邻前期，允许环比；同比要有明确上年同期，周报要有明确周列', () => {
  const f = finding('转化率从 4% 升到 5%，环比增长 1%。');
  assert.equal(f.status, 'issue');
  assert.deepEqual(f.suggestions,['转化率从 4% 升到 5%，环比增长 25%','转化率从 4% 升到 5%，环比增长 1个百分点']);
  assert.equal(finding('转化率同比增长 25%').status,'review');
  for (const header of ['去年同期','上年同期']) {
    const csv = '指标,'+header+',本期,单位\n转化率,4,5,%';
    assert.equal(finding('转化率同比增长 25%',csv).status,'ok');
    assert.equal(finding('转化率环比增长 25%',csv).status,'review');
  }
  const weekly = '指标,上周,本周,单位\n转化率,4,5,%';
  assert.equal(finding('本周转化率为 5%',weekly).status,'ok');
  assert.equal(finding('上周转化率为 4%',weekly).status,'ok');
  assert.equal(finding('转化率由上周的 4% 升至本周的 5%',weekly).status,'ok');
  assert.equal(finding('本周转化率为 5%').status,'review');
});

test('百分比来源可直接使用带分母的两期数值，证据保留原始分子/分母', () => {
  const csv = '指标,上期,本期,单位\n转化率,40/1000,50/1000,%';
  const f = finding('转化率从 4% 升到 5%，环比增长 1%。',csv);
  assert.equal(f.status,'issue');
  assert.match(f.evidence,/40\/1000（4%）/);
  assert.match(f.evidence,/50\/1000（5%）/);
  assert.equal(finding(f.suggestions[0],csv).status,'ok');
  for (const raw of ['40/0','1/2/3','x/2',' ','40/-1000']) {
    assert.equal(finding('转化率增长25%',csv.replace('40/1000',raw)).status,'review',raw);
  }
  assert.equal(finding('销售额增长25%','指标,上期,本期,单位\n销售额,40/1000,50/1000,元').status,'review');
});

test('超限输入返回明确错误而非部分通过结果，单句过长可单独复核', () => {
  const oversized = [
    ['1'.repeat(24001),base,'24,000'],
    ['转化率增长25%','a'.repeat(96001),'96,000'],
    ['转化率增长25%',base+'\n销售额,1,2,元'.repeat(499),'500'],
    ['转化率增长25%',Array.from({length:33},(_,i)=>String(i)).join(','),'32'],
    ['转化率增长25%。'.repeat(301),base,'300'],
  ];
  for (const [report,csv,limit] of oversized) {
    const result = audit(report,csv);
    assert.ok(result.errors.some(msg=>msg.includes(limit)),limit);
    assert.equal(result.findings.length,0);
  }
  const long = finding('转化率'+'很'.repeat(1001)+'25%');
  assert.equal(long.status,'review'); assert.match(long.formula,/1,000/);
});

test('建议修订保留金额的小数精度，修订结果可通过同一规则复核', () => {
  const csv = '指标,上期,本期,单位\n单价,0.00000001,0.000000025,元';
  const f = finding('本期单价为1元',csv);
  assert.equal(f.suggestions[0],'本期单价为0.000000025元');
  assert.equal(finding(f.suggestions[0],csv).status,'ok');
});
