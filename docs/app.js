document.addEventListener("DOMContentLoaded", () => {
  (async function main(){
    // ---------- helpers DOM ----------
    const $  = (id) => document.getElementById(id);
    const regionSel = $('region');
    let comunaEl    = $('comuna');   // si es input, lo transformamos en <select>
    const calleAInp = $('calleA');
    const calleBInp = $('calleB');
    const pageInp   = $('page');
    const statusEl  = $('status');
    const tbody     = document.querySelector('#tbl tbody');
    const thead     = document.querySelector('#tbl thead') || (() => {
      const t = document.querySelector('#tbl'); const th = document.createElement('thead'); t.prepend(th); return th;
    })();

    // ---------- regiones ----------
    const REGIONES = [
      ["region-metropolitana-de-santiago","Región Metropolitana de Santiago"],
      ["valparaiso","Valparaíso"],
      ["libertador-general-bernardo-ohiggins","Libertador General Bernardo O’Higgins"],
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
      allRows: [],      // resultado base de la búsqueda (cruce o 1 calle)
      filteredRows: [], // resultado tras filtros de encabezado
      filters: {},      // {col: value/string/expr}
      columns: [
        {key:"Fecha", label:"Fecha", type:"text"},
        {key:"Región", label:"Región", type:"cat"},
        {key:"Comuna", label:"Comuna", type:"cat"},
        {key:"Urbano/Rural", label:"Urbano/Rural", type:"cat"},
        {key:"Calleuno", label:"Calle 1", type:"text"},
        {key:"Calledos", label:"Calle 2", type:"text"},
        {key:"Ubicación/km", label:"Ubicación/km", type:"cat"},
        {key:"Siniestros", label:"Siniestros", type:"cat"},
        {key:"Causas", label:"Causas", type:"cat"},
        {key:"Fallecidos", label:"Fallecidos", type:"num"},
        {key:"Graves", label:"Graves", type:"num"},
        {key:"M/Grave", label:"M/Grave", type:"num"},
        {key:"Leves", label:"Leves", type:"num"},
        {key:"Ilesos", label:"Ilesos", type:"num"},
      ]
    };

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

    // convierte input#comuna en select#comuna
    function ensureComunaSelect(){
      if (comunaEl && comunaEl.tagName.toLowerCase() === 'select') return comunaEl;
      const sel = document.createElement('select');
      sel.id = 'comuna';
      sel.className = comunaEl.className || '';
      comunaEl.replaceWith(sel);
      comunaEl = sel;
      return sel;
    }

    async function populateComunas(regionSlug){
      const sel = ensureComunaSelect();
      sel.innerHTML = `<option value="">— Selecciona una comuna —</option>`;
      try{
        const comunas = await loadComunas(regionSlug);
        sel.innerHTML += comunas.map(c => `<option value="${c}">${c}</option>`).join('');
      }catch(e){
        console.error(e);
        sel.innerHTML = `<option value="">(Error cargando comunas)</option>`;
      }
    }

    // datalist opcional para calles
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
      const key1  = `${aSlug}__x__${bSlug}`;
      const key2  = `${bSlug}__x__${aSlug}`;
      const pack  = await loadPack(regionSlug, comuna);
      if (!pack) return [];
      const dict  = pack.intersections || {};
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
          el = document.createElement('select');
          el.multiple = true;
          el.innerHTML = `<option value="">(Todos)</option>`;
          // opciones únicas (capar a 200)
          const uniques = Array.from(new Set(state.allRows.map(r => r[c.key]).filter(x => x!==undefined && x!==null && String(x).trim()!==""))).sort();
          const sliced = uniques.slice(0, 200);
          el.innerHTML += sliced.map(v => `<option value="${String(v)}">${String(v)}</option>`).join('');
          if (uniques.length > 200){
            const opt = document.createElement('option');
            opt.value = "__MANY__";
            opt.textContent = `… (${uniques.length} valores)`;
            el.appendChild(opt);
          }
        } else {
          el = document.createElement('input');
          el.type = 'text';
          el.placeholder = (c.type === 'num') ? 'e.j. >=1' : 'contiene…';
        }
        el.dataset.col = c.key;
        el.addEventListener('input', onFilterChange);
        th.appendChild(el);
        tr2.appendChild(th);
      });

      thead.innerHTML = '';
      thead.appendChild(tr1);
      thead.appendChild(tr2);
    }

    function onFilterChange(ev){
      const el = ev.target;
      const col = el.dataset.col;
    
      let v;
    
      if (el.tagName === 'SELECT' && el.multiple){
        v = Array.from(el.selectedOptions)
          .map(o => o.value)
          .filter(x => x && x !== "__MANY__");
      } else {
        v = el.value.trim();
      }
    
      if (!v || (Array.isArray(v) && v.length === 0)){
        delete state.filters[col];
      } else {
        state.filters[col] = v;
      }
    
      applyFilters();
    }

    function applyFilters(){
      const f = state.filters;
      const rows = state.allRows.filter(r => {
        for (const col in f){
          const rule = f[col];
          const val = r[col];
          if (rule === "__MANY__") continue; // no aplicar
          const sc = state.columns.find(x => x.key===col);
          if (sc?.type === 'num'){
            // mini sintaxis: >=n, <=n, =n, n (igual)
            const m = String(rule).match(/^(>=|<=|=)?\s*(-?\d+(?:\.\d+)?)$/);
            const num = parseFloat(val ?? 'NaN');
            if (!m || Number.isNaN(num)) return false;
            const op = m[1] || '=';
            const rhs = parseFloat(m[2]);
            if (op==='=' && !(num === rhs)) return false;
            if (op==='>=' && !(num >= rhs)) return false;
            if (op<=' ' && !(num === rhs)) return false; // safeguard
            if (op==='<= ' && !(num <= rhs)) return false;
            if (op==='<=') { if (!(num <= rhs)) return false; }
          } else if (sc?.type === 'cat'){
            if (Array.isArray(rule)){
              if (!rule.map(String).includes(String(val))) return false;
            } else {
              if (String(val) !== String(rule)) return false;
            }
          } else {
            const needle = rmAcc(rule).toLowerCase();
            const hay = rmAcc(String(val||"")).toLowerCase();
            if (!hay.includes(needle)) return false;
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

      // pinta cuerpo
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

      statusEl.textContent = `Mostrando ${slice.length} de ${total} filas (pág. ${state.page}/${pages})`;
    }

    // ---------- export ----------
    function toCSV(rows, delimiter=','){
      const cols = state.columns.map(c => c.key);
      const esc = (s) => {
        const v = s==null ? '' : String(s);
        // si contiene comillas, saltos de línea o el delimitador → entrecomillar y duplicar comillas
        if (v.includes('"') || v.includes('\n') || v.includes(delimiter)) {
          return `"${v.replace(/"/g,'""')}"`;
        }
        return v;
      };
      const head = cols.join(delimiter);
      const body = rows.map(r => cols.map(k => esc(r[k])).join(delimiter)).join('\n');
      return head + '\n' + body;
    }

    function download(filename, text){
      const BOM = '\uFEFF'; // <- hace que Excel lea UTF-8 correctamente
      const blob = new Blob([BOM + text], {type:'text/csv;charset=utf-8;'});
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    }

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
      try{
        statusEl.textContent = 'Buscando…';
        const regionSlug = regionSel.value;
        const comuna     = (comunaEl.value||"").trim();
        const Araw       = (calleAInp.value||"").trim();
        const Braw       = (calleBInp.value||"").trim();

        if (!regionSlug){ statusEl.textContent='Elige una región.'; return; }
        if (!comuna){ statusEl.textContent='Elige una comuna.'; return; }
        if (!Araw && !Braw){ statusEl.textContent='Ingresa al menos una calle.'; return; }

        const pack = await loadPack(regionSlug, comuna);
        if (!pack){ statusEl.textContent='Sin datos para esa comuna.'; return; }

        let rows = [];
        if (!Araw || !Braw){
          // una sola calle → coincidencias flexibles
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
          statusEl.textContent = `Coincidencias por una calle.`;
        } else {
          // dos calles → exacta por slug o flexible por candidatas
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
            statusEl.textContent = rows.length ? 'Cruce flexible (variantes).' : 'Sin resultados para el cruce.';
          } else {
            statusEl.textContent = 'Cruce exacto.';
          }
        }

        // set base & filtros
        state.allRows = rows;
        state.filters = {};
        buildHeaderFilters(); // necesita allRows para armar opciones
        state.filteredRows = [...state.allRows];
        state.page = 1;
        pageInp.value = 1;
        renderPage();
      }catch(e){
        console.error(e);
        statusEl.textContent = 'Ocurrió un error. Revisa consola.';
      }
    }

    // eventos UI
    regionSel.addEventListener('change', async () => {
      await populateComunas(regionSel.value);
      tbody.innerHTML=''; statusEl.textContent='Selecciona una comuna.';
    });
    document.addEventListener('change', async (ev) => {
      if (ev.target && ev.target.id === 'comuna'){
        const comuna = comunaEl.value;
        if (comuna){
          await populateStreetDatalists(regionSel.value, comuna);
          tbody.innerHTML=''; statusEl.textContent='Ingresa calles y busca.';
        }
      }
    });
    $('buscar').addEventListener('click', () => { runQuery(); });
    $('limpiar').addEventListener('click', () => {
      if (comunaEl.tagName.toLowerCase()==='select') comunaEl.selectedIndex = 0; else comunaEl.value='';
      calleAInp.value=''; calleBInp.value='';
      state.page=1; pageInp.value=1; state.allRows=[]; state.filteredRows=[]; state.filters={};
      thead.innerHTML=''; tbody.innerHTML=''; statusEl.textContent='Listo';
    });

    $('prev').addEventListener('click', () => {
      if (state.page > 1){ state.page--; pageInp.value = state.page; renderPage(); }
    });
    $('next').addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(state.filteredRows.length / state.limit));
      if (state.page < pages){ state.page++; pageInp.value = state.page; renderPage(); }
    });
    pageInp.addEventListener('change', () => {
      let p = parseInt(pageInp.value||'1',10);
      if (Number.isNaN(p) || p < 1) p = 1;
      const pages = Math.max(1, Math.ceil(state.filteredRows.length / state.limit));
      if (p > pages) p = pages;
      state.page = p;
      pageInp.value = p;
      renderPage();
    });

    // arranque: poblar comunas de la región por defecto
    await populateComunas(regionSel.value);
  })();
});
