import { DEFAULT_API } from './config.js';
// Money data source.
// Priority: ?raised=NUMBER  >  ?api=URL (or DEFAULT_API: the Node server, polled)  >  data/goals/<goal>.json on this site
// (written by the GitHub Action, see README "Revenue API")  >  demo fallback.

export function parseParams() {
  const p = new URLSearchParams(location.search);
  const num = (v) => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const g = p.get('goal');
  const goalIsAmount = g !== null && num(g) !== null;          // legacy: ?goal=164500 was the goal amount
  const goalId = !goalIsAmount && g && /^[a-z0-9-]{1,40}$/.test(g) ? g : 'default';
  const lp = p.get('lowpower');
  return {
    car: p.get('car'),
    raised: num(p.get('raised')),
    goalId,
    target: num(p.get('target')) ?? (goalIsAmount ? num(g) : null),   // goal amount override
    label: p.get('label'),
    api: p.get('api'),
    demo: p.get('demo') === '1',
    embed: p.get('embed') === '1',
    drag: p.get('drag') === '1',      // in ?embed=1 dragging is off unless ?drag=1
    header: p.get('header') === '1',  // in ?embed=1 the header is hidden unless ?header=1
    chart: p.get('chart') !== '0',    // ?chart=0 hides the history chart + recent list
    lowpower: lp === '1' ? true : lp === '0' ? false : null,   // null = automatic
    poll: num(p.get('poll')),
  };
}

const withBust = (url) => url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();

async function getJson(url, timeout = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(withBust(url), { cache: 'no-store', signal: ctl.signal });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return null;
    return { json: await r.json() };
  } catch (e) {
    return null;
  } finally { clearTimeout(t); }
}

export class DataSource {
  /** onState(state, mode, history|null)  mode: 'param' | 'api' | 'pages' | 'demo'; history = [{ts,type,amount,note,raised}] or null (unchanged) */
  constructor(params, onState) {
    this.params = params;
    this.onState = onState;
    this.mode = 'demo';
    this.timer = null;
    this.lastUpdated = null;
    this.lastFetch = 0;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.tick && Date.now() - this.lastFetch > 5000) this.tick(); });
  }

  async start() {
    const P = this.params;
    if (P.raised !== null) {
      this.mode = 'param';
      this.onState({ raised: P.raised }, 'param', null);
      return;
    }
    const api = P.api || DEFAULT_API;
    if (api) {                                   // Node server (server/index.js) or any URL returning {raised, goal?, car?, label?, history?}
      const ok = await this.fetchApi(api);
      if (ok) { this.mode = 'api'; this.loop(() => this.fetchApi(api), P.poll || 10); return; }
      console.warn('[car-tracker] API unreachable, trying the GitHub data files:', api);
    }
    // GitHub-native data: data/goals/<id>.json + data/history/<id>.json, committed by .github/workflows/revenue.yml
    const res = await this.fetchPages(true);
    if (res === 'demo' || res === false) { this.mode = 'demo'; if (res === false) this.onState({ raised: 0 }, 'demo', null); return; }
    this.mode = 'pages';
    this.loop(() => this.fetchPages(false), P.poll || 30);
  }

  loop(fn, seconds) {
    this.tick = () => { this.lastFetch = Date.now(); return fn(); };
    this.timer = setInterval(() => { if (!document.hidden) this.tick(); }, Math.max(3, seconds) * 1000);
  }

  async fetchApi(url) {
    this.lastFetch = Date.now();
    const r = await getJson(url, 6000);
    if (!r || !r.json || typeof r.json.raised !== 'number') return false;
    const { history, ...st } = r.json;
    this.onState(st, 'api', Array.isArray(history) ? history : null);
    return true;
  }

  // returns 'demo' (goal flagged demo), false (no data at all), or true
  async fetchPages(first) {
    const id = this.params.goalId;
    this.lastFetch = Date.now();
    const r = await getJson(`./data/goals/${id}.json`);
    if (!r) return first ? false : true;                       // network error: keep the last value
    if (r.missing) {
      if (first && id === 'default') return false;
      this.onState({ raised: 0, label: id === 'default' ? undefined : id, missing: true }, 'pages', first ? [] : null);   // created by the first push
      return true;
    }
    const st = r.json;
    if (first && st.demo) { const { raised, ...rest } = st; this.onState({ ...rest, raised: 0 }, 'demo', null); return 'demo'; }
    let hist = null;
    if (st.updatedAt !== this.lastUpdated) {
      const h = await getJson(`./data/history/${id}.json`);
      hist = h && h.json && Array.isArray(h.json.events) ? h.json.events : first ? [] : null;
      this.lastUpdated = st.updatedAt;
    }
    this.onState(st, 'pages', hist);
    return true;
  }
}
