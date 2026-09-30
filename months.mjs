import { getStore } from '@netlify/blobs';

// Shared store of months loaded through the page. One JSON document keyed by
// month label ("Jul 2026") holding the raw CSV-shaped row for that month.
export const config = { path: '/api/months' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const store = () => getStore({ name: 'therapy-fin', consistency: 'strong' });
const KEY = 'months';
const read = async s => (await s.get(KEY, { type: 'json' })) ?? {};

export default async (req) => {
  const s = store();
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') return json(await read(s));
    if (req.method === 'PUT') {
      const body = await req.json().catch(() => null);
      if (!body || !body.month || !body.row) return json({ error: 'Body must include month and row.' }, 400);
      const all = await read(s);
      all[body.month] = { ...body.row, _updatedAt: new Date().toISOString() };
      await s.setJSON(KEY, all);
      return json({ ok: true, count: Object.keys(all).length });
    }
    if (req.method === 'DELETE') {
      const m = url.searchParams.get('month');
      if (url.searchParams.get('all')) { await s.setJSON(KEY, {}); return json({ ok: true, count: 0 }); }
      if (!m) return json({ error: 'Pass month or all=1.' }, 400);
      const all = await read(s); delete all[m]; await s.setJSON(KEY, all);
      return json({ ok: true, count: Object.keys(all).length });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
};
