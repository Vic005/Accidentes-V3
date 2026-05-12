document.addEventListener("DOMContentLoaded", () => {
  (async function main(){
    // ---------- helpers DOM ----------
    const $ = (id) => document.getElementById(id);
    const regionSel  = $('region');
    let comunaEl     = $('comuna');
    const calleAInp  = $('calleA');
    const calleBInp  = $('calleB');
    const pageInp    = $('page');
    const statusEl   = $('status');
    const tbody      = document.querySelector('#tbl tbody');
    const thead      = document.querySelector('#tbl thead');

    // UI panels
    const emptyState   = $('empty-state');
    const resultsPanel = $('results-panel');
    const loadingState = $('loading-state');

    // ---------- regiones ----------
    const REGIONES = [
      ["region-metropolitana-de-santiago","Región Metropolitana de Santiago"],
      ["valparaiso","Valparaíso"],
      ["libertador-general-bernardo-ohiggins","Libertador General Bernardo O'Higgins"],
      ["maule","Maule"],["nuble","Ñuble"],["biobio","Biobío"],["la-araucania","La Araucanía"],
      ["los-rios","Los Ríos"],["los-lagos","Los Lagos"],
      ["aysen-del-general-carlos-ibanez-del-campo","Aysén del General Carlos Ibáñez del Campo"],
      ["magallanes-y-de-la-antartica-chilena","Magallanes y de la Antártica Chilena"],
      ["arica-y-parinacota","Arica y Parinacota"],["tarapaca","Tarapacá"],
      ["antofagasta","Antofagasta"],["atacama","Atacama"],["coquimbo","Coquimbo"],
    ];
    regionSel.innerHTML = REGIONES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');

    // ---------- estado global ----------
    const state = {
      page: 1,
      limit: 100,
      allRows: [],
      filteredRows: [],
      filters: {},
      currentLabel: '',
      columns: [
        {key:"Fecha",        label:"Fecha",         type:"text"},
        {key:"Región",       label:"Región",        type:"cat"},
        {key:"Comuna",       label:"Comuna",        type:"cat"},
        {key:"Urbano/Rural", label:"Urbano/Rural",  type:"cat"},
        {key:"Calleuno",     label:"Calle 1",       type:"text"},
        {key:"Calledos",     label:"Calle 2",       type:"text"},
        {key:"Ubicación/km", label:"Ubic./km",      type:"cat"},
        {key:"Siniestros",   label:"Siniestros",    type:"cat"},
        {key:"Causas",       label:"Causas",        type:"cat"},
        {key:"Fallecidos",   label:"Fallecidos",    type:"num"},
        {key:"Graves",       label:"Graves",        type:"num"},
        {key:"M/Grave",      label:"M/Grave",       type:"num"},
        {key:"Leves",        label:"Leves",         type:"num"},
        {key:"Ilesos",       label:"Ilesos",        type:"num"},
      ]
    };

    // ---------- download queue ----------
    const queueItems = []; // [{label, rows}]

    // ---------- utils ----------
    const rmAcc = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const slug  = (s) => rmAcc(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "sin-dato";

    // cache
    const comunasCache  = new Map();
    const streetsCache  = new Map();
    const packCache     = new Map();

    async function loadComunas(regionSlug){
      if (comunasCache.has(regionSlug)) return comunasCache.get(regionSlug);
      const url = `data-json/${regionSlug}/comunas.json`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`No pude cargar comunas: ${url}`);
      const js = await r.json();
      comunasCache.set(regionSlug, js);
      return js;
    }

    async function loadStreets(regionSlug, comuna){
      const key = `${regionSlug}::${comuna}`;
      if (streetsCache.has(key)) return streetsCache.get(key);
      const url = `data-json/${regionSlug}/streets/${slug(comuna)}.json`;
      const r = await fetch(url);
      const js = r.ok ? await r.json() : [];
      streetsCache.set(key, js);
      return js;
    }

    async function loadPack(regionSlug, comuna){
      const key = `${regionSlug}::${comuna}`;
      if (packCache.has(key)) return packCache.get(key);
      const url = `data-json/${regionSlug}/intersections/${slug(comuna)}/pack.json`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const js = await r.json();
      packCache.set(key, js);
      return js;
    }

    // populateComunas (ahora usa el select directamente)
    async function populateComunas(regionSlug){
      comunaEl.innerHTML = `<option value="">— Selecciona una comuna —</option>`;
      try {
        const comunas = await loadComunas(regionSlug);
        comunaEl.innerHTML += comunas.map(c => `<option value="${c}">${c}</option>`).join('');
      } catch(e) {
        console.error(e);
        comunaEl.innerHTML = `<option value="">(Error cargando comunas)</option>`;
      }
    }

    // datalist para calles
    async function populateStreetDatalists(regionSlug, comuna){
      const listIdA = 'dl-calleA', listIdB = 'dl-calleB';
      let dlA = document.getElementById(listIdA);
      let dlB = document.getElementById(listIdB);
      if (!dlA){ dlA = document.createElement('datalist'); dlA.id = listIdA; document.body.appendChild(dlA); }
      if (!dlB){ dlB = document.createElement('datalist'); dlB.id = listIdB; document.body.appendChild(dlB); }
      calleAInp.setAttribute('list', listIdA);
      calleBInp.setAttribute('list', listIdB);
      const streets = await loadStreets(regionSlug, comuna);
      const opts = streets.map(s => `<option value="${s}"></option>`).join('');
      dlA.innerHTML = opts;
      dlB.innerHTML = opts;
    }

    // ---------- búsqueda ----------
    function normStreet(s){
      let t = rmAcc(String(s||"")).toLowerCase().trim();
      t = t.replace(/^(av(\.|da)?|avenida|calle|cll|pje|psje|pasaje|cam(\.|ino)?|diag(\.|onal)?|ruta|autopista|costanera|boulevard|bvd)\s+/, "");
      t = t.replace(/[.,]/g," ").replace(/\s+/g," ").trim();
      return t;
    }

    async function candidateStreets(regionSlug, comuna, query, maxN=10){
      const q = normStreet(query);
      if (!q) return [];
      const streets = await loadStreets(regionSlug, comuna);
      const scored = [];
      for (const s of streets){
        const ns = normStreet(s);
        if (!ns) continue;
        if (ns.includes(q)){
          const idx = ns.indexOf(q);
          const score = idx + ns.length * 0.05;
          scored.push([score, s]);
        }
      }
      scored.sort((a,b)=>a[0]-b[0]);
      return scored.slice(0, maxN).map(x=>x[1]);
    }

    async function loadIntersection(regionSlug, comuna, calleA, calleB){
      const A = (calleA||"").trim(), B = (calleB||"").trim();
      if (!A || !B) return [];
      const aSlug = slug(A), bSlug = slug(B);
      const key1 = `${aSlug}__x__${bSlug}`;
      const key2 = `${bSlug}__x__${aSlug}`;
      const pack = await loadPack(regionSlug, comuna);
      if (!pack) return [];
      const dict = pack.intersections || {};
      return dict[key1] || dict[key2] || [];
    }

    // ---------- filtros de encabezado ----------
    function buildHeaderFilters(){
      // fila 1: labels
      const tr1 = document.createElement('tr');
      state.columns.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c.label;
        tr1.appendChild(th);
      });

      // fila 2: inputs/selects
      const tr2 = document.createElement('tr');
      state.columns.forEach(c => {
        const th = document.createElement('th');
        let el;

        if (c.type === 'cat'){
          el = document.createElement('div');
          el.className = 'filter-box';

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'filter-btn';
          btn.innerHTML = `<span>Filtrar</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

          const panel = document.createElement('div');
          panel.className = 'filter-panel';

          const uniques = Array.from(
            new Set(state.allRows.map(r => r[c.key]).filter(x => x!==undefined && x!==null && String(x).trim()!==""))
          ).sort().slice(0, 200);

          uniques.forEach(v => {
            const lbl = document.createElement('label');
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = String(v);
            lbl.appendChild(chk);
            lbl.append(' ' + String(v));
            panel.appendChild(lbl);
          });

          const applyBtn = document.createElement('button');
          applyBtn.type = 'button';
          applyBtn.className = 'filter-apply';
          applyBtn.textContent = 'Aplicar filtro';

          applyBtn.addEventListener('click', () => {
            const selected = Array.from(panel.querySelectorAll('input:checked')).map(i => i.value);
            if (selected.length){
              state.filters[c.key] = selected;
              btn.classList.add('has-filter');
            } else {
              delete state.filters[c.key];
              btn.classList.remove('has-filter');
            }
            applyFilters();
            panel.style.display = 'none';
            btn.classList.remove('active');
          });

          panel.appendChild(applyBtn);

          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.style.display === 'block';
            // close all other panels
            document.querySelectorAll('.filter-panel').forEach(p => p.style.display = 'none');
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            panel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) btn.classList.add('active');
          });

          el.appendChild(btn);
          el.appendChild(panel);
        } else {
          el = document.createElement('input');
          el.type = 'text';
          // Calles: indicar búsqueda cruzada
          if (c.key === 'Calleuno' || c.key === 'Calledos'){
            el.placeholder = 'busca en ambas calles…';
            el.title = 'Busca en Calle 1 Y Calle 2 a la vez';
          } else {
            el.placeholder = (c.type === 'num') ? '≥1, ≤5…' : 'buscar…';
          }
          el.dataset.col = c.key;
          el.addEventListener('input', onFilterChange);
        }

        th.appendChild(el);
        tr2.appendChild(th);
      });

      thead.innerHTML = '';
      thead.appendChild(tr1);
      thead.appendChild(tr2);

      // close panels on outside click
      document.addEventListener('click', () => {
        document.querySelectorAll('.filter-panel').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      }, { capture: true });
    }

    function onFilterChange(ev){
      const col = ev.target.dataset.col;
      const v = ev.target.value.trim();
      if (!v) delete state.filters[col];
      else state.filters[col] = v;
      applyFilters();
    }

    function applyFilters(){
      const f = state.filters;
      const rows = state.allRows.filter(r => {
        for (const col in f){
          const rule = f[col];
          const val = r[col];
          if (rule === "__MANY__") continue;
          const sc = state.columns.find(x => x.key===col);

          if (sc?.type === 'num'){
            const m = String(rule).match(/^(>=|<=|=)?\s*(-?\d+(?:\.\d+)?)$/);
            const num = parseFloat(val ?? 'NaN');
            if (!m || Number.isNaN(num)) return false;
            const op = m[1] || '=';
            const rhs = parseFloat(m[2]);
            if (op==='=' && !(num === rhs)) return false;
            if (op==='>=' && !(num >= rhs)) return false;
            if (op==='<=') { if (!(num <= rhs)) return false; }

          } else if (sc?.type === 'cat'){
            if (Array.isArray(rule)){
              if (!rule.map(String).includes(String(val))) return false;
            } else {
              if (String(val) !== String(rule)) return false;
            }

          } else {
            // Para columnas de calle: buscar en AMBAS (Calleuno y Calledos)
            const needle = rmAcc(rule).toLowerCase();
            if (col === 'Calleuno' || col === 'Calledos'){
              const hay1 = rmAcc(String(r['Calleuno']||'')).toLowerCase();
              const hay2 = rmAcc(String(r['Calledos']||'')).toLowerCase();
              if (!hay1.includes(needle) && !hay2.includes(needle)) return false;
            } else {
              const hay = rmAcc(String(val||'')).toLowerCase();
              if (!hay.includes(needle)) return false;
            }
          }
        }
        return true;
      });
      state.filteredRows = rows;
      state.page = 1;
      pageInp.value = 1;
      renderPage();
    }

    // ---------- render & paginación ----------
    function renderPage(){
      const total = state.filteredRows.length;
      const pages = Math.max(1, Math.ceil(total / state.limit));
      if (state.page > pages) state.page = pages;

      const start = (state.page - 1) * state.limit;
      const slice = state.filteredRows.slice(start, start + state.limit);

      tbody.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const r of slice){
        const tr = document.createElement('tr');
        for (const c of state.columns){
          const td = document.createElement('td');
          td.textContent = r[c.key] == null ? '' : String(r[c.key]);
          tr.appendChild(td);
        }
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);

      statusEl.textContent = `${total} resultados · página ${state.page}/${pages}`;
      $('page-total').textContent = `de ${pages}`;
    }

    // ---------- show/hide panels ----------
    const actionBar = $('action-bar');

    function showEmpty(){
      emptyState.style.display = '';
      resultsPanel.style.display = 'none';
      loadingState.style.display = 'none';
      actionBar.style.display = 'none';
    }
    function showLoading(){
      emptyState.style.display = 'none';
      resultsPanel.style.display = 'none';
      loadingState.style.display = '';
      actionBar.style.display = 'none';
    }
    function showResults(){
      emptyState.style.display = 'none';
      loadingState.style.display = 'none';
      resultsPanel.style.display = '';
      actionBar.style.display = 'flex';
    }

    // ---------- toast ----------
    function showToast(msg, type='success'){
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = `<span>${msg}</span>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3200);
    }

    // ---------- export CSV ----------
    function toCSV(rows, delimiter=','){
      const cols = state.columns.map(c => c.key);
      const esc = (s) => {
        const v = s==null ? '' : String(s);
        if (v.includes('"') || v.includes('\n') || v.includes(delimiter)) return `"${v.replace(/"/g,'""')}"`;
        return v;
      };
      return cols.join(delimiter) + '\n' + rows.map(r => cols.map(k => esc(r[k])).join(delimiter)).join('\n');
    }

    function download(filename, text){
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + text], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    }

    function toCSVWithCols(rows, columns, delimiter=','){
      const cols = columns.map(c => c.key);
      const esc = (s) => {
        const v = s==null ? '' : String(s);
        if (v.includes('"') || v.includes('\n') || v.includes(delimiter)) return `"${v.replace(/"/g,'""')}"`;
        return v;
      };
      return cols.join(delimiter) + '\n' + rows.map(r => cols.map(k => esc(r[k])).join(delimiter)).join('\n');
    }

    // ---------- queue UI ----------
    function renderQueueList(){
      const listEl = $('queue-list');
      const actionsEl = $('queue-actions');
      if (!queueItems.length){
        listEl.innerHTML = `
          <div class="queue-empty">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="6" y="8" width="20" height="16" rx="3" stroke="#ccc" stroke-width="1.5"/><path d="M10 13h12M10 17h8" stroke="#ccc" stroke-width="1.5" stroke-linecap="round"/></svg>
            <p>Sin búsquedas guardadas</p>
          </div>`;
        actionsEl.style.display = 'none';
        return;
      }
      listEl.innerHTML = '';
      queueItems.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.innerHTML = `
          <div class="queue-item-info">
            <div class="queue-item-label" title="${item.label}">${item.label}</div>
            <div class="queue-item-meta">${item.meta || ''}</div>
          </div>
          <span class="queue-item-count">${item.rows.length} filas</span>
          <button class="queue-item-remove" data-idx="${i}" title="Eliminar">×</button>
        `;
        listEl.appendChild(div);
      });
      actionsEl.style.display = 'flex';
    }

    $('queue-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.queue-item-remove');
      if (btn){
        const idx = parseInt(btn.dataset.idx, 10);
        queueItems.splice(idx, 1);
        renderQueueList();
      }
    });

    $('add-to-queue').addEventListener('click', () => {
      if (!state.filteredRows.length){
        showToast('No hay resultados para guardar', 'warning');
        return;
      }
      const region = regionSel.options[regionSel.selectedIndex]?.text || '';
      const comuna = comunaEl.value || '';
      const calleA = calleAInp.value.trim();
      const calleB = calleBInp.value.trim();
      const label  = calleA && calleB ? `${calleA} × ${calleB}` : calleA || calleB || 'Sin nombre';
      const meta   = [comuna, region].filter(Boolean).join(' · ');

      queueItems.push({
        label,
        meta,
        rows: state.filteredRows.map(r => Object.assign({}, r)),  // deep copy cada fila
        columns: state.columns.map(c => Object.assign({}, c))
      });
      renderQueueList();
      showToast(`✓ "${label}" agregado a la cola`);
    });

    $('export-queue').addEventListener('click', () => {
      if (!queueItems.length){ showToast('La cola está vacía', 'warning'); return; }

      // CSV unificado: cabecera única + columna "Búsqueda" para identificar cada filtrado
      const cols = state.columns.map(c => c.key);
      const esc = (s) => {
        const v = s==null ? '' : String(s);
        if (v.includes('"') || v.includes('\n') || v.includes(',')) return `"${v.replace(/"/g,'""')}"`;
        return v;
      };

      const header = cols.join(',');
      const bodyLines = [];
      queueItems.forEach(item => {
        item.rows.forEach(r => {
          const line = cols.map(k => esc(r[k])).join(',');
          bodyLines.push(line);
        });
      });

      const csv = '\uFEFF' + header + '\n' + bodyLines.join('\n');
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'accidentes_cola_unificado.csv';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      const total = queueItems.reduce((s, i) => s + i.rows.length, 0);
      showToast(`✓ ${queueItems.length} búsquedas · ${total} filas exportadas`);
    });

    $('clear-queue').addEventListener('click', () => {
      queueItems.length = 0;
      renderQueueList();
      showToast('Cola vaciada', 'warning');
    });

    // ---------- export page & all ----------
    $('export-page')?.addEventListener('click', () => {
      const start = (state.page - 1) * state.limit;
      const slice = state.filteredRows.slice(start, start + state.limit);
      download('accidentes_pagina.csv', toCSV(slice));
    });
    $('export-all')?.addEventListener('click', () => {
      download('accidentes_filtrado.csv', toCSV(state.filteredRows));
    });

    // ---------- acciones principales ----------
    async function runQuery(){
      try {
        showLoading();
        const regionSlug = regionSel.value;
        const comuna     = (comunaEl.value||"").trim();
        const Araw       = (calleAInp.value||"").trim();
        const Braw       = (calleBInp.value||"").trim();

        if (!regionSlug){ showToast('Elige una región', 'warning'); showEmpty(); return; }
        if (!comuna){ showToast('Elige una comuna', 'warning'); showEmpty(); return; }
        if (!Araw && !Braw){ showToast('Ingresa al menos una calle', 'warning'); showEmpty(); return; }

        const pack = await loadPack(regionSlug, comuna);
        if (!pack){ showToast('Sin datos para esa comuna', 'warning'); showEmpty(); return; }

        let rows = [];
        let statusMsg = '';
        if (!Araw || !Braw){
          const needle = normStreet(Araw || Braw);
          const seen = new Set();
          for (const key in (pack.intersections||{})){
            const arr = pack.intersections[key] || [];
            for (const r of arr){
              const c1 = normStreet(r["Calleuno"]);
              const c2 = normStreet(r["Calledos"]);
              if (c1.includes(needle) || c2.includes(needle)){
                const sig = JSON.stringify(r);
                if (!seen.has(sig)){ seen.add(sig); rows.push(r); }
              }
            }
          }
          statusMsg = `Búsqueda por una calle`;
        } else {
          rows = await loadIntersection(regionSlug, comuna, Araw, Braw);
          if (!rows.length){
            const candA = await candidateStreets(regionSlug, comuna, Araw, 10);
            const candB = await candidateStreets(regionSlug, comuna, Braw, 10);
            const dict  = (pack.intersections||{});
            const seen  = new Set();
            for (const ca of candA){
              for (const cb of candB){
                const k1 = `${slug(ca)}__x__${slug(cb)}`;
                const k2 = `${slug(cb)}__x__${slug(ca)}`;
                const arr = dict[k1] || dict[k2] || [];
                for (const r of arr){
                  const sig = JSON.stringify(r);
                  if (!seen.has(sig)){ seen.add(sig); rows.push(r); }
                }
              }
            }
            statusMsg = rows.length ? 'Cruce flexible encontrado' : 'Sin resultados para el cruce';
          } else {
            statusMsg = 'Cruce exacto encontrado';
          }
        }

        state.allRows = rows;
        state.filters = {};
        buildHeaderFilters();
        state.filteredRows = [...state.allRows];
        state.page = 1;
        pageInp.value = 1;
        state.currentLabel = `${Araw}${Braw ? ' × ' + Braw : ''}`;

        if (rows.length){
          showResults();
          renderPage();
          statusEl.textContent = `${rows.length} resultados · ${statusMsg}`;
        } else {
          showEmpty();
          emptyState.querySelector('h2').textContent = 'Sin resultados';
          emptyState.querySelector('p').textContent = statusMsg + '. Intenta con otra combinación de calles.';
          showToast(statusMsg, 'warning');
        }
      } catch(e) {
        console.error(e);
        showEmpty();
        showToast('Error al buscar. Revisa la consola.', 'warning');
      }
    }

    // ---------- eventos UI ----------
    regionSel.addEventListener('change', async () => {
      await populateComunas(regionSel.value);
      showEmpty();
    });

    comunaEl.addEventListener('change', async () => {
      const comuna = comunaEl.value;
      if (comuna){
        await populateStreetDatalists(regionSel.value, comuna);
        showEmpty();
      }
    });

    $('buscar').addEventListener('click', () => runQuery());

    $('limpiar').addEventListener('click', () => {
      comunaEl.selectedIndex = 0;
      calleAInp.value = ''; calleBInp.value = '';
      state.page = 1; pageInp.value = 1;
      state.allRows = []; state.filteredRows = []; state.filters = {};
      thead.innerHTML = ''; tbody.innerHTML = '';
      showEmpty();
      emptyState.querySelector('h2').textContent = 'Realiza una búsqueda';
      emptyState.querySelector('p').textContent = 'Selecciona región, comuna e ingresa al menos una calle para ver los accidentes registrados.';
    });

    $('prev').addEventListener('click', () => {
      if (state.page > 1){ state.page--; pageInp.value = state.page; renderPage(); }
    });

    $('next').addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(state.filteredRows.length / state.limit));
      if (state.page < pages){ state.page++; pageInp.value = state.page; renderPage(); }
    });

    pageInp.addEventListener('change', () => {
      let p = parseInt(pageInp.value||'1', 10);
      if (Number.isNaN(p) || p < 1) p = 1;
      const pages = Math.max(1, Math.ceil(state.filteredRows.length / state.limit));
      if (p > pages) p = pages;
      state.page = p; pageInp.value = p;
      renderPage();
    });

    // ---------- arranque ----------
    await populateComunas(regionSel.value);
    showEmpty();
  })();
});
