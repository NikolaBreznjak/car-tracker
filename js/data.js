import { DEFAULT_API } from './config.js';
// Money data source.
// Priority: ?raised=NUMBER  >  ?api=URL (or default ./api/state, polled)  >  demo fallback.

export function parseParams() {
  const p = new URLSearchParams(location.search);
  const num = (v) => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
  return {
    car: p.get('car'),
    raised: num(p.get('raised')),
    goal: num(p.get('goal')),
    label: p.get('label'),
    api: p.get('api'),
    demo: p.get('demo') === '1',
    embed: p.get('embed') === '1',
    drag: p.get('drag') === '1',   // in ?embed=1 dragging is off unless ?drag=1
    poll: Math.max(3, num(p.get('poll')) || 10),
  };
}

export class DataSource {
  /** onState({raised, goal?, car?, label?}, mode) mode: 'param' | 'api' | 'demo' */
  constructor(params, onState) {
    this.params = params;
    this.onState = onState;
    this.mode = 'demo';
    this.timer = null;
  }

  async start() {
    const P = this.params;
    if (P.raised !== null) {
      this.mode = 'param';
      this.onState({ raised: P.raised }, 'param');
      return;
    }
    const url = P.api || DEFAULT_API || './api/state';
    const ok = await this.fetchOnce(url);
    if (ok) {
      this.mode = 'api';
      this.timer = setInterval(() => this.fetchOnce(url), P.poll * 1000);
    } else {
      this.mode = 'demo';
      this.onState({ raised: 0 }, 'demo');
    }
  }

  async fetchOnce(url) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return false;
      const j = await r.json();
      if (typeof j.raised !== 'number') return false;
      this.onState(j, 'api');
      return true;
    } catch (e) {
      return false;
    }
  }
}
