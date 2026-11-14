/**
 * [INPUT]: 依赖隔离报告的 DOM、父级主题消息及报告可选的 ECharts 实例。
 * [OUTPUT]: 非破坏性的深色阅读适配与恢复，保持原始文件和图表语义色。
 * [POS]: UI 的独立预览脚本，由 ArtifactPreview 注入沙箱，不包含原生桥。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function installPreviewTheme(initialDark) {
  let dark = initialDark, scheduled = false;
  const changes = new Map(), charts = new Map();
  const rgb = (value) => {
    const values = String(value).match(/[\d.]+/g)?.map(Number);
    return values?.length >= 3 && (values.length < 4 || values[3] > 0) ? values : null;
  };
  const brightness = (c) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  const neutral = (c) => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3)) < 30;
  const tint = (c, base, amount) => `rgb(${c.slice(0, 3).map(v => Math.round(base + (v - base) * amount)).join(',')})`;
  function set(element, property, value) {
    if (!changes.has(element)) changes.set(element, new Map());
    const saved = changes.get(element);
    if (!saved.has(property)) saved.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    element.style.setProperty(property, value, 'important');
  }
  function reset() {
    for (const [element, properties] of changes) for (const [key, [value, priority]] of properties) {
      if (value) element.style.setProperty(key, value, priority); else element.style.removeProperty(key);
    }
    changes.clear();
  }
  function adaptCharts() {
    if (!window.echarts) return;
    for (const element of document.querySelectorAll('[_echarts_instance_]')) {
      const chart = window.echarts.getInstanceByDom(element);
      if (!chart || chart.isDisposed?.()) continue;
      if (!charts.has(chart)) charts.set(chart, {original: chart.getOption(), dark: null});
      const saved = charts.get(chart);
      if (saved.dark === dark) continue;
      saved.dark = dark;
      const original = saved.original;
      if (!dark) {chart.setOption(original, {notMerge: true, lazyUpdate: false}); continue;}
      const patch = {
        backgroundColor: 'transparent', textStyle: {color: '#d6d6d6'},
        title: (original.title ?? []).map(() => ({textStyle: {color: '#ececec'}, subtextStyle: {color: '#aaa'}})),
        legend: (original.legend ?? []).map(() => ({textStyle: {color: '#c4c4c4'}, inactiveColor: '#666'})),
        tooltip: (original.tooltip ?? []).map(() => ({backgroundColor: '#292929', borderColor: '#444', textStyle: {color: '#eee'}})),
      };
      for (const key of ['xAxis', 'yAxis', 'radiusAxis', 'angleAxis']) if (original[key]) {
        patch[key] = original[key].map(() => ({nameTextStyle: {color: '#aaa'}, axisLabel: {color: '#aaa'}, axisLine: {lineStyle: {color: '#666'}}, splitLine: {lineStyle: {color: '#3c3c3c'}}}));
      }
      patch.series = (original.series ?? []).map(() => ({label: {color: '#d6d6d6'}, markLine: {label: {color: '#aaa'}}}));
      chart.setOption(patch, {lazyUpdate: false});
    }
  }
  function apply() {
    scheduled = false;
    reset();
    if (dark && document.body) {
      // -- 先读取原始样式，避免父节点变色干扰子节点的继承色判断 --
      const styles = [...document.querySelectorAll('html,body,body *')]
        .filter(el => !['SCRIPT','STYLE','LINK','META','CANVAS','IMG'].includes(el.tagName) && el.namespaceURI === 'http://www.w3.org/1999/xhtml')
        .map(el => {const style = getComputedStyle(el); return [el, style.color, style.backgroundColor, style.borderTopColor, style.backgroundImage];});
      for (const [element, color, background, border, image] of styles) {
        const fg = rgb(color), bg = rgb(background), edge = rgb(border);
        if (fg && brightness(fg) < 155) set(element, 'color', neutral(fg) ? (brightness(fg) < 65 ? '#ececec' : '#aaa') : tint(fg, 255, .72));
        if (bg && brightness(bg) > 155) set(element, 'background-color', neutral(bg) ? (element === document.body || element === document.documentElement ? '#1d1d1d' : '#252525') : tint(bg, 29, .16));
        if (edge && brightness(edge) > 155) set(element, 'border-color', '#3c3c3c');
        if (image.includes('gradient(')) set(element, 'background-image', 'none');
      }
      set(document.documentElement, 'color-scheme', 'dark');
      set(document.documentElement, 'background-color', '#1d1d1d');
      set(document.body, 'background-color', '#1d1d1d');
      set(document.body, 'color', '#ececec');
    }
    adaptCharts();
  }
  function schedule() {
    if (!scheduled) {scheduled = true; requestAnimationFrame(apply);}
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'workbuddy-preview-theme' || typeof event.data.dark !== 'boolean') return;
    dark = event.data.dark; schedule();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, {once: true}); else schedule();
  window.addEventListener('load', schedule, {once: true});
  new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
}
