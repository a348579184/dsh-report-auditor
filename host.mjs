import { audit } from './engine.mjs';

export const inject = ['tools'];

const column = { type: 'string', description: 'Exact CSV column heading.' };
const stringList = { type: 'array', items: { type: 'string' } };

export function apply(ctx) {
  ctx.tools.register({
    name: 'audit_report_numbers',
    description: 'Check Chinese report statements against supplied CSV text. Returns source evidence, formulas and possible revisions. review means manual verification is needed. Does not edit files. Only use data supplied for this task.',
    parameters: {
      type: 'object',
      properties: {
        report: { type: 'string', description: 'Original report text or Markdown.' },
        csv: { type: 'string', description: 'CSV text with a header and metric, previous period, current period, and optional unit columns.' },
        mapping: {
          type: 'object',
          description: 'Optional explicit column names if automatic detection cannot match the headings.',
          properties: { metric: column, previous: column, current: column, unit: column },
          additionalProperties: false
        }
      },
      required: ['report', 'csv'],
      additionalProperties: false
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          errors: stringList,
          findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
          summary: { type: 'object', additionalProperties: true }
        },
        required: ['errors', 'findings', 'summary'],
        additionalProperties: true
      },
      render(_args, result) {
        return [{ type: 'text', text: JSON.stringify(result) }];
      }
    },
    execute({ report, csv, mapping }, exec) {
      exec.signal.throwIfAborted();
      if (typeof report !== 'string' || typeof csv !== 'string') {
        throw new TypeError('report and csv must both be strings.');
      }
      return audit(report, csv, mapping);
    },
    isConcurrencySafe: () => true
  });
}
