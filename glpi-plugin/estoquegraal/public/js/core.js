(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EstoqueGraalCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function quantity(value) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? ''));
    if (!m) return '—';
    const fraction = (m[3] || '').replace(/0+$/, '');
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : '');
  }
  function inputQuantity(value) {
    const raw = String(value).trim();
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,3})?$/.test(raw)) throw new Error('Quantidade inválida. Use unidades inteiras; ponto separa milhares.');
    const parts = raw.replace(/\./g, '').split(',');
    if (parts[1] && /[1-9]/.test(parts[1])) throw new Error('A API atual aceita apenas unidades inteiras.');
    return parts[0];
  }
  function positive(value) { return /^\d+(?:\.\d+)?$/.test(String(value)) && /[1-9]/.test(String(value)); }
  class Latest { constructor() { this.version = 0; } invalidate() { return ++this.version; } current(n) { return n === this.version; } }
  return {quantity, inputQuantity, positive, Latest};
});
