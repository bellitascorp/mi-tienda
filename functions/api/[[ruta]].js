// Servidor de la tienda (Cloudflare Pages Functions). Atiende todo lo que empiece con /api/
// Variables: TIENDA (KV), MASTER_PASSWORD, GITHUB_TOKEN, GITHUB_REPO (usuario/repo), GITHUB_BRANCH
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const iguales = (a, b) => { const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b)); let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0); return d === 0; };
const gh = async (env, p, o = {}) => {
  const x = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${p}`, { ...o, headers: { authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'tienda-bellitas', 'content-type': 'application/json' } });
  if (!x.ok) throw new Error(`GitHub respondió ${x.status} en ${p || 'repositorio'}`);
  return x.json();
};
// Sube varios archivos en UN solo commit (cuenta como una sola publicación de las 500 mensuales)
async function subir(env, files) {
  const br = env.GITHUB_BRANCH || 'main';
  const base = (await gh(env, '/git/ref/heads/' + br)).object.sha;
  const cm = await gh(env, '/git/commits/' + base), tree = [];
  for (const f of files) tree.push({ path: f.ruta, mode: '100644', type: 'blob', sha: (await gh(env, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.b64, encoding: 'base64' }) })).sha });
  const t = await gh(env, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: cm.tree.sha, tree }) });
  const n = await gh(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message: 'Medios subidos desde el panel', tree: t.sha, parents: [base] }) });
  await gh(env, '/git/refs/heads/' + br, { method: 'PATCH', body: JSON.stringify({ sha: n.sha }) });
}
export async function onRequest({ request, env, params }) {
  const r = [].concat(params.ruta || []).join('/'), m = request.method, kv = env.TIENDA;
  try {
    if (!kv) return J({ error: 'Falta enlazar la memoria KV con el nombre TIENDA' }, 500);
    // Pública: la tienda lee su catálogo, diseño y módulos
    if (r === 'tienda' && m === 'GET') { const d = await kv.get('tienda'); return d ? new Response(d, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' } }) : J({ error: 'vacio' }, 404); }
    // Acceso maestro: la contraseña vive en el servidor, nunca en el navegador
    if (r === 'login' && m === 'POST') {
      const { clave = '' } = await request.json().catch(() => ({}));
      if (!env.MASTER_PASSWORD || !iguales(clave, env.MASTER_PASSWORD)) { await new Promise(x => setTimeout(x, 800)); return J({ error: 'Contraseña incorrecta' }, 401); }
      const t = crypto.randomUUID() + crypto.randomUUID(); await kv.put('s:' + t, 'master', { expirationTtl: 28800 }); return J({ token: t });
    }
    // Desde aquí, todo exige sesión
    const t = (request.headers.get('authorization') || '').slice(7);
    if (!t || !(await kv.get('s:' + t))) return J({ error: 'Sesión vencida' }, 401);
    if (r === 'sesion') return J({ ok: true });
    if (r === 'tienda' && m === 'PUT') {
      const b = await request.text(); if (b.length > 400000) return J({ error: 'Datos demasiado grandes' }, 413);
      let d; try { d = JSON.parse(b); } catch { return J({ error: 'JSON inválido' }, 400); }
      if (!Array.isArray(d.catalogo) || !d.diseno || !d.modulos_activos) return J({ error: 'Estructura inválida' }, 400);
      await kv.put('tienda', JSON.stringify(d)); return J({ ok: true });
    }
    if (r === 'media' && m === 'POST') {
      const { archivos } = await request.json().catch(() => ({}));
      if (!Array.isArray(archivos) || !archivos.length || archivos.length > 8) return J({ error: 'Archivos inválidos' }, 400);
      // Solo se permite escribir dentro de /media (nunca tocar el código)
      for (const f of archivos) if (!/^media\/[a-z0-9-]+\.(webp|mp4|webm)$/.test(f.ruta) || typeof f.b64 !== 'string' || f.b64.length > 6e6) return J({ error: 'Archivo no permitido: ' + f.ruta }, 400);
      await subir(env, archivos); return J({ ok: true });
    }
    if (r === 'diag') {
      const br = env.GITHUB_BRANCH || 'main', T = (n, ok, ayuda = '') => ({ n, ok, ayuda });
      const p = [T('Memoria KV (TIENDA) enlazada', true), T('Contraseña maestra definida', !!env.MASTER_PASSWORD, 'Settings → Variables and Secrets → MASTER_PASSWORD'),
        T('Token de GitHub definido', !!env.GITHUB_TOKEN, 'Settings → Variables and Secrets → GITHUB_TOKEN'),
        T('Repositorio con formato usuario/repo', /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || ''), 'Variable GITHUB_REPO, por ejemplo maria/tienda')];
      if (p.every(x => x.ok)) try {
        const g = await gh(env, ''); p.push(T('GitHub responde y el token ve el repositorio', true), T('El token puede escribir', g.permissions?.push !== false, 'Crea el token con Contents: Read and write'), T(g.private ? 'Repositorio privado' : 'Repositorio público (conviene hacerlo privado)', true));
        await gh(env, '/git/ref/heads/' + br); p.push(T('La rama ' + br + ' existe', true));
      } catch (e) { p.push(T('Conexión con GitHub', false, e.message + '. Revisa repositorio, rama y token.')); }
      return J({ pruebas: p });
    }
    return J({ error: 'No existe' }, 404);
  } catch (e) { return J({ error: e.message }, 500); }
}
