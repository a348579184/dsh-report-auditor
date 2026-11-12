// build.mjs embeds the offline workbench into this registered browser module.
window.__ModuleLoader__.load({
  id: 'dsh-report-auditor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const panelId = 'report-auditor';
    const namespace = 'dsh-report-auditor';
    const workbenchDocument = '__DSH_WORKBENCH_DOCUMENT__';

    function AuditIcon({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true
      }, h('path', { d: 'M3 19v-6m4 6V9m4 10V5m2 6 3 3 5-7' }));
    }

    function Workbench() {
      return h('section', {
        style: {
          width: '100%', height: '100%', minHeight: 0, boxSizing: 'border-box',
          paddingTop: 'var(--dsh-frame-top-clearance, 0px)', background: '#f7f8f4'
        }
      }, h('iframe', {
        title: '数字校对台', srcDoc: workbenchDocument,
        sandbox: 'allow-scripts allow-same-origin allow-downloads',
        style: { display: 'block', width: '100%', height: '100%', border: 'none' }
      }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(namespace, {
          zh: { panel: '数字校对台' }, en: { panel: 'Report number auditor' }
        }));
        const t = ctx.locale.bind(namespace);
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: panelId
        }, Workbench));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: panelId, order: 30,
          label: () => t('panel'), locale: namespace
        }, AuditIcon));
      }
    };
  }
});
