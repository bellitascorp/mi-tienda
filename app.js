'use strict';
/* =====================================================================
   app.js – Panel de operador
   - Acceso local (contraseña con hash SHA-256) + token de GitHub en localStorage
   - Editor de catálogo / diseño / módulos con vista previa en vivo (postMessage)
   - Publicación: GET (SHA actual) + PUT a la API de contenidos de GitHub
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const LS = 'tienda_admin_cfg';            // { hash, owner, repo, branch, path, token }  (solo en este navegador)
const FUENTES = {
  'Sistema (rápida)': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  'Serif elegante': "Georgia, 'Times New Roman', serif",
  'Moderna': "'Trebuchet MS', Verdana, sans-serif",
  'Máquina de escribir': "'Courier New', monospace"
};
const TEMAS = [
  { n: 'Claro', color_fondo: '#ffffff', color_texto: '#111827', color_primario: '#0f766e' },
  { n: 'Oscuro', color_fondo: '#111827', color_texto: '#f9fafb', color_primario: '#f59e0b' },
  { n: 'Rosa', color_fondo: '#fff1f2', color_texto: '#4c0519', color_primario: '#be123c' },
  { n: 'Océano', color_fondo: '#f0f9ff', color_texto: '#082f49', color_primario: '#0369a1' }
];
const MODULOS = {
  buscador_activo: 'Buscador predictivo',
  filtros_avanzados: 'Filtros de categoría y orden',
  alertas_stock_bajo: 'Alertas de stock bajo',
  modo_mantenimiento: 'Modo mantenimiento',
  whatsapp_flotante: 'Botón flotante de WhatsApp'
};

let D = null, tab = 'cat', editId = null, dirty = false, tPrev;
const getCfg = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };
const setStatus = (t, err) => { const s = $('#status'); s.textContent = t; s.className = 'text-sm font-semibold min-h-5 ' + (err ? 'text-red-700' : 'text-teal-800'); };
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tienda:' + t)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const sorted = () => [...D.catalogo].sort((a, b) => a.orden - b.orden);

/* ================= Acceso: la contraseña maestra se verifica en el servidor ================= */
function logErr(m) { try { const a = JSON.parse(localStorage.getItem('err_log') || '[]'); a.push({ t: new Date().toISOString(), m: String(m).slice(0, 200), u: 'admin' }); localStorage.setItem('err_log', JSON.stringify(a.slice(-30))); } catch {} }
addEventListener('error', e => logErr(e.message));
addEventListener('unhandledrejection', e => logErr(e.reason));
const tk = () => sessionStorage.getItem('tk');
async function api(p, o = {}) {
  const r = await fetch('/api/' + p, { ...o, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tk() } });
  if (r.status === 401 && p !== 'login') { sessionStorage.removeItem('tk'); location.reload(); }
  return r;
}
function showAuth() { $('#ws').hidden = true; $('#auth').hidden = false; $('#fSetup').hidden = true; $('#fLogin').hidden = false; }
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); $('#authErr').textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ clave: new FormData(e.target).get('pwd') }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error(j.error || 'El servidor no responde (revisa la carpeta functions y la memoria KV)');
    sessionStorage.setItem('tk', j.token); e.target.reset(); start();
  } catch (x) { $('#authErr').textContent = 'No se pudo entrar: ' + x.message; logErr('login: ' + x.message); }
});
$('#reset').addEventListener('click', () => alert('La contraseña maestra se cambia en Cloudflare: tu proyecto → Settings → Variables and Secrets → MASTER_PASSWORD.'));
$('#btnLogout').addEventListener('click', () => { sessionStorage.removeItem('tk'); location.reload(); });

/* ================= Arranque ================= */
async function start() {
  $('#auth').hidden = true; $('#ws').hidden = false;
  try {
    let j = null; try { j = await (await fetch('/api/tienda', { cache: 'no-store' })).json(); } catch {}
    D = j?.catalogo ? j : await (await fetch('productos.json?v=' + Date.now())).json();
  } catch { setStatus('No se pudo cargar productos.json', true); return; }
  view(); sendPreview(); api('sesion');
}

/* ================= Vista previa ================= */
function sendPreview() {
  clearTimeout(tPrev);
  tPrev = setTimeout(() => $('#pv').contentWindow?.postMessage({ type: 'preview', data: D }, location.origin), 120);
}
$('#pv').addEventListener('load', sendPreview);
document.addEventListener('click', e => { const b = e.target.closest('[data-dev]'); if (b) $('#pv').style.width = b.dataset.dev; });
const touch = () => { dirty = true; sendPreview(); };
addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

/* ================= Pestañas ================= */
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; editId = null; view(); }));
function view() {
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on);
    b.className = 'min-h-12 text-xs sm:text-sm font-bold border-b-4 ' + (on ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-600');
  });
  $('#panel').innerHTML = tab === 'cat' ? vCat() : tab === 'dis' ? vDis() : tab === 'mod' ? vMod() : tab === 'med' ? vMed() : vEst();
}

/* ---------- Catálogo ---------- */
const btnI = (a, id, l, t, x = '') => `<button type="button" data-a="${a}" data-id="${id}" aria-label="${l}" class="min-h-11 min-w-11 rounded-lg border-2 border-slate-300 font-bold ${x}">${t}</button>`;
function vCat() {
  if (editId !== null) return vForm();
  const l = sorted();
  return `<button data-a="new" class="w-full min-h-12 rounded-xl bg-teal-700 text-white font-bold mb-3">+ Nueva prenda</button>
  <ul class="space-y-2">${l.map((p, i) => `<li class="flex items-center gap-2 rounded-xl border p-2">
    <img src="${esc(p.imagen_url)}" alt="" width="48" height="60" class="w-12 h-14 object-cover rounded-lg bg-slate-200">
    <div class="flex-1 min-w-0"><p class="font-bold truncate">${esc(p.nombre)}</p><p class="text-sm text-slate-600">S/. ${p.precio_oferta} · Stock ${p.stock}</p></div>
    ${btnI('up', p.id, 'Subir', '↑', i === 0 ? 'opacity-40' : '')}${btnI('down', p.id, 'Bajar', '↓', i === l.length - 1 ? 'opacity-40' : '')}
    ${btnI('edit', p.id, 'Editar ' + esc(p.nombre), '✎')}${btnI('del', p.id, 'Eliminar ' + esc(p.nombre), '🗑')}</li>`).join('')}</ul>
  ${l.length ? '' : '<p class="text-center text-slate-600 py-8">Aún no hay prendas. Crea la primera.</p>'}`;
}
/* Fila de color: nombre + foto de ese color */
const colRow = c => `<li class="flex gap-2 items-end"><label class="flex-1 text-xs font-semibold">Color<input name="col_n" value="${esc(c.nombre)}" class="mt-1 w-full min-h-11 rounded-lg border px-2 font-normal"></label>
  <label class="flex-[2] text-xs font-semibold">Foto de este color (URL)<input name="col_i" type="url" value="${esc(c.imagen_url)}" class="mt-1 w-full min-h-11 rounded-lg border px-2 font-normal"></label>
  <button type="button" data-a="delcol" aria-label="Quitar color" class="min-h-11 min-w-11 rounded-lg border-2 border-slate-300 font-bold">✕</button></li>`;
const leerColores = (form, fotoBase) => { const fd = new FormData(form), im = fd.getAll('col_i');
  return fd.getAll('col_n').map((n, i) => ({ nombre: n.trim(), imagen_url: (im[i] || '').trim() || fotoBase })).filter(c => c.nombre); };
function vForm() {
  const p = editId === 'new' ? { nombre: '', descripcion_corta: '', precio_original: '', precio_oferta: '', categoria: '', imagen_url: '', colores: [], tallas: [], stock: 0 } : D.catalogo.find(x => x.id === editId);
  const f = (n, l, v, t = 'text', x = '') => `<label class="block text-sm font-semibold">${l}<input name="${n}" type="${t}" value="${esc(v)}" ${x} class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal"></label>`;
  return `<form id="fP" class="space-y-3">
    <h2 class="text-lg font-extrabold">${editId === 'new' ? 'Nueva prenda' : 'Editar prenda'}</h2>
    ${f('nombre', 'Nombre', p.nombre, 'text', 'required')}
    <label class="block text-sm font-semibold">Descripción corta<textarea name="descripcion_corta" rows="3" class="mt-1 w-full rounded-xl border px-3 py-2 font-normal">${esc(p.descripcion_corta)}</textarea></label>
    <div class="grid grid-cols-2 gap-3">${f('precio_original', 'Precio original (S/.)', p.precio_original, 'number', 'required min="0" step="0.01"')}${f('precio_oferta', 'Precio oferta (S/.)', p.precio_oferta, 'number', 'required min="0" step="0.01"')}</div>
    ${f('categoria', 'Categoría', p.categoria, 'text', 'required')}
    ${f('imagen_url', 'URL de la imagen', p.imagen_url, 'url', 'required')}
    <fieldset class="space-y-2"><legend class="text-sm font-semibold">Colores y la foto de cada color</legend>
      <ul id="cols" class="space-y-2">${(p.colores.length ? p.colores : [{ nombre: '', imagen_url: '' }]).map(c => colRow(typeof c === 'string' ? { nombre: c, imagen_url: p.imagen_url } : c)).join('')}</ul>
      <button type="button" data-a="addcol" class="min-h-11 px-3 rounded-lg border-2 border-slate-300 font-bold">+ Agregar color</button></fieldset>
    ${f('tallas', 'Tallas (separadas por coma)', p.tallas.join(', '))}
    ${f('stock', 'Stock', p.stock, 'number', 'required min="0" step="1"')}
    <p id="fErr" role="alert" class="text-sm font-semibold text-red-700"></p>
    <div class="grid grid-cols-2 gap-2"><button type="button" data-a="cancel" class="min-h-12 rounded-xl border-2 border-slate-300 font-bold">Cancelar</button>
    <button class="min-h-12 rounded-xl bg-teal-700 text-white font-bold">Guardar prenda</button></div></form>`;
}
const lista = s => s.split(',').map(x => x.trim()).filter(Boolean);
function move(id, dir) {
  const l = sorted(), i = l.findIndex(p => p.id === id), j = i + dir;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; l.forEach((p, k) => p.orden = k + 1);
  touch(); view();
}
$('#panel').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const { a, id } = b.dataset;
  if (a === 'new') { editId = 'new'; view(); }
  if (a === 'edit') { editId = id; view(); }
  if (a === 'cancel') { editId = null; view(); }
  if (a === 'addcol') $('#cols').insertAdjacentHTML('beforeend', colRow({ nombre: '', imagen_url: '' }));
  if (a === 'delcol') b.closest('li').remove();
  if (a === 'up') move(id, -1);
  if (a === 'down') move(id, 1);
  if (a === 'del' && confirm('¿Eliminar esta prenda?')) { D.catalogo = D.catalogo.filter(p => p.id !== id); touch(); view(); }
  if (a === 'tema') { Object.assign(D.diseno, TEMAS[+id], { n: undefined }); delete D.diseno.n; touch(); view(); }
});
$('#panel').addEventListener('submit', e => {
  if (e.target.id !== 'fP') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const orig = parseFloat(f.precio_original), of = parseFloat(f.precio_oferta), st = parseInt(f.stock, 10);
  if (!(orig >= 0) || !(of >= 0) || !(st >= 0)) return $('#fErr').textContent = 'Revisa precios y stock: deben ser números positivos.';
  if (of > orig) return $('#fErr').textContent = 'El precio de oferta no puede superar al precio original.';
  const data = { nombre: f.nombre.trim(), descripcion_corta: f.descripcion_corta.trim(), precio_original: orig, precio_oferta: of,
    categoria: f.categoria.trim(), imagen_url: f.imagen_url.trim(), colores: leerColores(e.target, f.imagen_url.trim()), tallas: lista(f.tallas), stock: st };
  if (editId === 'new') D.catalogo.push({ id: 'p' + Date.now(), orden: D.catalogo.length + 1, ...data });
  else Object.assign(D.catalogo.find(p => p.id === editId), data);
  editId = null; touch(); view(); setStatus('Prenda guardada (aún sin publicar)');
});

/* ---------- Diseño ---------- */
function vDis() {
  const d = D.diseno;
  const col = (k, l) => `<label class="block text-sm font-semibold">${l}<input type="color" data-d="${k}" value="${esc(d[k])}" class="mt-1 w-full h-12 rounded-xl border"></label>`;
  return `<div class="space-y-3">
    <p class="font-bold">Temas predefinidos</p>
    <div class="grid grid-cols-2 gap-2">${TEMAS.map((t, i) => `<button data-a="tema" data-id="${i}" class="min-h-12 rounded-xl border-2 font-bold" style="background:${t.color_fondo};color:${t.color_texto};border-color:${t.color_primario}">${t.n}</button>`).join('')}</div>
    <label class="block text-sm font-semibold">Nombre de la tienda<input data-d="nombre_tienda" value="${esc(d.nombre_tienda)}" class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal"></label>
    <label class="block text-sm font-semibold">WhatsApp (con código de país, solo números)<input data-d="whatsapp_numero" inputmode="numeric" value="${esc(d.whatsapp_numero)}" class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal"></label>
    <div class="grid grid-cols-3 gap-2">${col('color_fondo', 'Fondo')}${col('color_texto', 'Texto')}${col('color_primario', 'Primario')}</div>
    <label class="block text-sm font-semibold">Tipografía<select data-d="fuente_principal" class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal">
      ${Object.entries(FUENTES).map(([n, v]) => `<option value="${esc(v)}" ${d.fuente_principal === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    ${selF('fuente_titulo', 'Fuente de títulos y del nombre')}${selF('fuente_cuerpo', 'Fuente de textos')}${selF('fuente_precio', 'Fuente de precios')}
    <label class="block text-sm font-semibold">Tamaño del nombre<input type="range" data-d="nombre_tamano" min="16" max="48" step="1" value="${esc(d.nombre_tamano || 20)}" class="mt-1 w-full"></label>
    <label class="block text-sm font-semibold">Color del nombre<input type="color" data-d="nombre_color" value="${esc(d.nombre_color || d.color_primario)}" class="mt-1 w-full h-12 rounded-xl border"></label>
    <label class="block text-sm font-semibold">Texto del banner de promociones<input data-d="banner_texto" value="${esc(d.banner_texto)}" class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal"></label>
    <label class="flex items-center gap-3 min-h-12 font-semibold"><input type="checkbox" data-d="banner_activo" ${d.banner_activo ? 'checked' : ''} class="size-6"> Mostrar banner</label></div>`;
}
// Cambios de diseño y módulos: actualizan el estado y la vista previa sin re-renderizar (mantiene el foco)
$('#panel').addEventListener('input', e => {
  const k = e.target.dataset.d; if (!k) return;
  D.diseno[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; touch();
});
$('#panel').addEventListener('change', e => {
  const k = e.target.dataset.m; if (!k) return;
  D.modulos_activos[k] = e.target.checked; touch();
});

/* ---------- Interruptores ---------- */
function vMod() {
  return `<ul class="space-y-2">${Object.entries(MODULOS).map(([k, l]) => `<li>
    <label class="flex items-center justify-between gap-3 min-h-14 rounded-xl border p-3 font-semibold">${l}
    <input type="checkbox" role="switch" data-m="${k}" ${D.modulos_activos[k] ? 'checked' : ''} class="size-7 accent-teal-700"></label></li>`).join('')}</ul>`;
}

/* ================= Backup ================= */
$('#btnBackup').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' }));
  a.download = `productos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href); setStatus('Backup descargado');
});

/* ================= Guardar: instantáneo, en Cloudflare ================= */
$('#btnPublish').addEventListener('click', async () => {
  const b = $('#btnPublish'); b.disabled = true; setStatus('Guardando…');
  try {
    const r = await api('tienda', { method: 'PUT', body: JSON.stringify(D) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    dirty = false; setStatus('✓ Guardado. Tus clientas lo ven en segundos.');
  } catch (e) { setStatus('Error: ' + e.message, true); logErr('guardar: ' + e.message); }
  b.disabled = false;
});

/* ================= Tipografías ================= */
const FG = ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Lora', 'Cinzel', 'Abril Fatface', 'Merriweather', 'Great Vibes', 'Dancing Script', 'Pacifico', 'Satisfy', 'Montserrat', 'Poppins', 'Quicksand', 'Nunito', 'Raleway', 'Josefin Sans', 'Inter', 'Oswald', 'Bebas Neue'];
const selF = (k, l) => `<label class="block text-sm font-semibold">${l}<select data-d="${k}" class="mt-1 w-full min-h-12 rounded-xl border px-3 font-normal"><option value="">Por defecto</option>${FG.map(n => `<option ${D.diseno[k] === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;

/* ================= Medios: editor de fotos (recorte 4:5, ajustes, WebP en 3 tamaños) ================= */
let ed = null;
const sl = (k, l, mn, mx, st, v) => `<label class="block text-xs font-semibold">${l}<input type="range" data-e="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}" class="w-full"></label>`;
function vMed() {
  ed = null;
  return `<div class="space-y-3"><p class="text-sm text-slate-600">Sube una foto: se recorta en 4:5, se ajusta con el estilo cálido de la tienda y se comprime sola. Al aprobar, se guarda en tu repositorio sin que abras GitHub. Videos: MP4 o WebM de hasta 4 MB.</p>
  <input type="file" id="fil" accept="image/*,video/mp4,video/webm" class="w-full min-h-12">
  <canvas id="cv" width="320" height="400" class="w-full max-w-xs rounded-xl bg-slate-200" hidden></canvas>
  <div id="ctl" hidden class="space-y-2"><div id="sl" class="space-y-2">${sl('z', 'Zoom', 1, 3, .05, 1)}${sl('x', 'Mover horizontal', -1, 1, .05, 0)}${sl('y', 'Mover vertical', -1, 1, .05, 0)}${sl('b', 'Luz', .7, 1.4, .02, 1.03)}${sl('c', 'Contraste', .7, 1.5, .02, 1.08)}${sl('s', 'Color', .5, 1.6, .02, 1.1)}${sl('w', 'Calidez', 0, .5, .02, .12)}</div>
    <input id="mn" placeholder="Nombre del archivo (ej: polo-negro)" class="w-full min-h-12 rounded-xl border px-3">
    <button data-a="aprobar" class="w-full min-h-12 rounded-xl bg-teal-700 text-white font-bold disabled:opacity-50">Aprobar y subir</button></div>
  <div id="mres" class="text-sm font-semibold"></div></div>`;
}
function dib(cv, w, h) {
  const c = cv.getContext('2d'), f = ed.f, im = ed.img, sc = Math.max(w / im.width, h / im.height) * f.z, dw = im.width * sc, dh = im.height * sc;
  c.filter = `brightness(${f.b}) contrast(${f.c}) saturate(${f.s}) sepia(${f.w})`;
  c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
  c.drawImage(im, (w - dw) / 2 + f.x * (dw - w) / 2, (h - dh) / 2 + f.y * (dh - h) / 2, dw, dh);
}
$('#panel').addEventListener('change', async e => {
  if (e.target.id !== 'fil' || !e.target.files[0]) return;
  const f = e.target.files[0], m = $('#mres'); m.textContent = '';
  if (f.type.startsWith('video/')) {
    if (f.size > 4e6) { m.textContent = 'El video pesa más de 4 MB. Recórtalo a 5 segundos y 720p antes de subirlo.'; return; }
    ed = { vid: f }; $('#cv').hidden = true; $('#sl').hidden = true;
  } else {
    try { ed = { img: await createImageBitmap(f), f: { z: 1, x: 0, y: 0, b: 1.03, c: 1.08, s: 1.1, w: .12 } }; } catch { m.textContent = 'Ese formato no se puede leer. Usa JPG, PNG o WebP.'; return; }
    $('#cv').hidden = false; $('#sl').hidden = false; dib($('#cv'), 320, 400);
  }
  $('#ctl').hidden = false;
});
$('#panel').addEventListener('input', e => { const k = e.target.dataset.e; if (k && ed?.f) { ed.f[k] = +e.target.value; dib($('#cv'), 320, 400); } });
const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(t); };
async function aprobar(btn) {
  if (!ed) return; btn.disabled = true;
  const slug = ($('#mn').value || 'prenda').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prenda', id = Date.now().toString(36), out = [], m = $('#mres');
  try {
    m.textContent = 'Preparando…';
    if (ed.vid) out.push({ ruta: `media/${slug}-${id}.${ed.vid.type.includes('webm') ? 'webm' : 'mp4'}`, b64: await b64(ed.vid) });
    else for (const w of [960, 640, 320]) { const cv = document.createElement('canvas'); cv.width = w; cv.height = w * 1.25; dib(cv, cv.width, cv.height); out.push({ ruta: `media/${slug}-${id}-${w}.webp`, b64: await b64(await new Promise(r => cv.toBlob(r, 'image/webp', .82))) }); }
    m.textContent = 'Subiendo a tu repositorio…';
    const r = await api('media', { method: 'POST', body: JSON.stringify({ archivos: out }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    const main = out[out.length > 1 ? 1 : 0].ruta;
    m.textContent = '⏳ Publicando ' + main + ' (suele tardar cerca de 1 minuto)…';
    for (let i = 0; i < 40; i++) {                  // espera a que el archivo esté realmente en línea
      await new Promise(x => setTimeout(x, 5000));
      const h = await fetch('/' + main, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (h?.ok && /^(image|video)\//.test(h.headers.get('content-type') || '')) {
        m.innerHTML = `✓ En línea: <code>${esc(main)}</code><div class="flex gap-2 mt-2"><select id="selP" class="flex-1 min-h-11 rounded-lg border px-2">${D.catalogo.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select><button data-a="usar" data-id="${esc(main)}" class="min-h-11 px-3 rounded-lg bg-teal-700 text-white">Usar como foto principal</button></div>`;
        btn.disabled = false; return;
      }
    }
    m.textContent = 'Tarda más de lo normal. Ve a Estado y ejecuta el diagnóstico.';
  } catch (e) { m.textContent = 'Error: ' + e.message; logErr('subir: ' + e.message); }
  btn.disabled = false;
}

/* ================= Estado: diagnóstico y reportes ================= */
let ultDiag = null;
function vEst() {
  const errs = JSON.parse(localStorage.getItem('err_log') || '[]');
  return `<div class="space-y-3"><button data-a="diag" class="w-full min-h-12 rounded-xl bg-teal-700 text-white font-bold">Ejecutar diagnóstico</button><div id="dg" class="text-sm space-y-1"></div>
  <p class="font-bold">Errores guardados en este equipo (${errs.length})</p>
  <ul class="text-xs space-y-1">${errs.slice(-8).reverse().map(x => `<li class="rounded border p-2">${esc(x.t.slice(11, 19))} · ${esc(x.m)} <span class="text-slate-500">${esc(x.u)}</span></li>`).join('') || '<li class="text-slate-500">Sin errores.</li>'}</ul>
  <button data-a="copiar" class="w-full min-h-12 rounded-xl border-2 border-slate-300 font-bold">Copiar reporte para Claude</button></div>`;
}
async function diag() {
  const el = $('#dg'); el.textContent = 'Revisando…';
  try { const r = await api('diag'); ultDiag = (await r.json()).pruebas; el.innerHTML = ultDiag.map(p => `<div class="${p.ok ? 'text-teal-800' : 'text-red-700'}">${p.ok ? '✓' : '✗'} ${esc(p.n)}${p.ok ? '' : ' — ' + esc(p.ayuda)}</div>`).join(''); }
  catch (e) { el.textContent = 'No se pudo ejecutar: ' + e.message; }
}
$('#panel').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'aprobar') aprobar(b);
  if (a === 'diag') diag();
  if (a === 'usar') { const p = D.catalogo.find(x => x.id === $('#selP').value); if (p) { p.imagen_url = b.dataset.id; touch(); setStatus('Foto asignada a ' + p.nombre + '. Pulsa Guardar y publicar.'); } }
  if (a === 'copiar') {
    const t = ['REPORTE ' + new Date().toISOString(), navigator.userAgent, 'Diagnóstico: ' + JSON.stringify(ultDiag || 'no ejecutado'), 'Errores: ' + (localStorage.getItem('err_log') || '[]')].join('\n');
    try { await navigator.clipboard.writeText(t); setStatus('Reporte copiado. Pégalo en el chat.'); } catch { prompt('Copia este reporte:', t); }
  }
});

/* ================= Inicio ================= */
tk() ? start() : showAuth();
