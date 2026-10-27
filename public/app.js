(function () {
  "use strict";

  // ======================= Constantes =======================
  const SECTEURS = {
    informatique: { label: "Informatique & télécoms", em: "💻", c: "#4f46e5" },
    sante: { label: "Santé & social", em: "🩺", c: "#e11d48" },
    btp: { label: "Bâtiment & TP", em: "🏗️", c: "#d97706" },
    industrie: { label: "Industrie & ingénierie", em: "🏭", c: "#64748b" },
    maintenance: { label: "Maintenance & réparation", em: "🔧", c: "#0891b2" },
    hotellerie: { label: "Hôtellerie & restauration", em: "🍽️", c: "#ea580c" },
    transport: { label: "Transport & logistique", em: "🚚", c: "#2563eb" },
    finance: { label: "Finance, gestion & droit", em: "💼", c: "#7c3aed" },
    commerce: { label: "Commerce & vente", em: "🛒", c: "#db2777" },
    services: { label: "Services aux personnes", em: "🤝", c: "#0d9488" },
    agriculture: { label: "Agriculture", em: "🌾", c: "#65a30d" },
    education: { label: "Éducation & formation", em: "🎓", c: "#9333ea" },
    autres: { label: "Autres métiers", em: "📌", c: "#6b7280" },
  };
  const STATUTS = [
    { id: "a-postuler", label: "À postuler" },
    { id: "postule", label: "Postulé" },
    { id: "relance", label: "Relancé" },
    { id: "entretien", label: "Entretien" },
    { id: "offre", label: "Offre reçue" },
    { id: "refuse", label: "Refusé" },
  ];
  const R_CATS = {
    dev: { label: "Développement & tech", em: "💻" },
    data: { label: "Data & IA", em: "📊" },
    design: { label: "Design", em: "🎨" },
    marketing: { label: "Marketing", em: "📣" },
    ventes: { label: "Ventes", em: "🤝" },
    support: { label: "Support client", em: "🎧" },
    redaction: { label: "Rédaction & traduction", em: "✍️" },
    finance: { label: "Gestion & finance", em: "💼" },
    autres: { label: "Autres", em: "📌" },
  };
  const R_TYPES = { freelance: "Freelance", contrat: "Contrat / mission", "temps-plein": "Temps plein", "temps-partiel": "Temps partiel", stage: "Stage" };
  const R_ZONES = [
    { id: "accessible", label: "🌍 Monde entier & Afrique", zones: ["monde", "afrique"] },
    { id: "europe", label: "Europe", zones: ["europe"] },
    { id: "all", label: "Toutes les offres", zones: null },
  ];
  const PAYS = { lu: { cc: "LU", nom: "Luxembourg" }, fr: { cc: "FR", nom: "France" }, remote: { cc: "WEB", nom: "Télétravail" } };
  const STORE = "mt-candidatures-v1";
  const statutLabel = Object.fromEntries(STATUTS.map((s) => [s.id, s.label]));

  // ======================= Utilitaires =======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const enc = encodeURIComponent;
  const nfFr = new Intl.NumberFormat("fr-FR");
  // Espace insécable classique : certaines polices n'ont pas l'espace fine (U+202F) utilisée par fr-FR.
  const nf = { format: (n) => nfFr.format(n).replace(/[  ]/g, " ") };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const sect = (id) => SECTEURS[id] || SECTEURS.autres;
  const tileStyle = (id) => `background:color-mix(in srgb, ${sect(id).c} 14%, transparent)`;
  const EXT = `<svg class="ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>`;

  function safeUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (e) {
      return "";
    }
  }
  function today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  const fmtDate = (iso) => (iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  let toastT;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }
  async function getJson(path) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  // ======================= État =======================
  const state = {
    lu: null, fr: null, idx: null,
    items: [],
    pays: "all", region: "all", secteur: "all", q: "", tri: "nom",
    cands: store.get(STORE, []),
    filtreStatut: "all",
    offresCache: {},
    remote: null, remoteLoading: null,
    rq: "", rZone: "accessible", rType: "all", rCat: "all", rShown: 30,
  };
  if (!Array.isArray(state.cands)) state.cands = [];

  // ======================= Données =======================
  // Mot-clé de recherche par défaut pour un métier luxembourgeois : le premier mot le plus
  // fréquent des intitulés (« Infirmier », « Développeur »…) ou, à défaut, l'intitulé le plus court.
  function motCleLu(m) {
    const courts = m.appellations.map((a) => a.court);
    const freq = {};
    courts.forEach((c) => { const w = c.split(" ")[0]; freq[w] = (freq[w] || 0) + 1; });
    const [top, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [];
    if (n >= 3) return top;
    return courts.slice().sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length)[0] || m.titre;
  }

  function buildItems() {
    const items = [];
    (state.lu?.metiers || []).forEach((m) => {
      items.push({
        id: `lu-${m.code}`, pays: "lu", code: m.code, titre: m.titre, secteur: m.secteur,
        appellations: m.appellations, exclues: m.exclues || [], motCle: motCleLu(m),
        hay: norm([m.code, m.titre, ...m.appellations.map((a) => a.nom)].join(" ")),
      });
    });
    (state.fr?.familles || []).forEach((f) => {
      items.push({
        id: `fr-${f.code}`, pays: "fr", code: f.code, titre: f.titre, secteur: f.secteur,
        regions: f.regions, rome: f.rome, motCle: f.titre.replace(/[()]/g, ""),
        hay: norm([f.code, f.titre, ...f.rome.map((r) => `${r.code} ${r.titre}`)].join(" ")),
      });
    });
    state.items = items;
  }

  const regionById = (id) => (state.fr?.regions || []).find((r) => r.id === id);
  function offresCount(item, region = state.region) {
    if (item.pays !== "fr" || !state.idx) return null;
    const t = state.idx.totaux || {};
    if (region !== "all") return item.regions.includes(region) ? t[region]?.[item.code] ?? null : null;
    let s = 0, any = false;
    item.regions.forEach((r) => { const v = t[r]?.[item.code]; if (typeof v === "number") { s += v; any = true; } });
    return any ? s : null;
  }

  function filtered({ ignoreSecteur = false } = {}) {
    const words = norm(state.q).split(/\s+/).filter(Boolean);
    return state.items.filter((it) => {
      if (state.pays !== "all" && it.pays !== state.pays) return false;
      if (state.region !== "all" && it.pays === "fr" && !it.regions.includes(state.region)) return false;
      if (state.region !== "all" && it.pays === "lu" && state.pays !== "lu") return false;
      if (!ignoreSecteur && state.secteur !== "all" && it.secteur !== state.secteur) return false;
      return words.every((w) => it.hay.includes(w));
    });
  }

  // ======================= Liens de recherche =======================
  function liensRecherche(item, kw, regionId) {
    const q = enc(kw);
    if (item.pays === "lu") {
      return [
        { label: "Indeed", url: `https://lu.indeed.com/jobs?q=${q}&l=Luxembourg` },
        { label: "Moovijob", url: `https://www.moovijob.com/recherche?q=${q}` },
        { label: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=Luxembourg` },
        { label: "jobs.lu", url: "https://www.jobs.lu/" },
      ];
    }
    const r = regionById(regionId);
    return [
      { label: "France Travail", url: `https://candidat.francetravail.fr/offres/recherche?motsCles=${q}${r ? `&lieux=${r.code}R` : ""}` },
      { label: "Indeed", url: `https://fr.indeed.com/jobs?q=${q}&l=${enc(r ? r.nom : "France")}` },
      { label: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${enc(r ? `${r.nom}, France` : "France")}` },
      { label: "HelloWork", url: `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${q}${r ? `&l=${enc(r.nom)}` : ""}` },
    ];
  }

  // ======================= Explorer =======================
  function renderStats() {
    const nLu = state.lu?.metiers.length || 0;
    const nFr = state.fr?.familles.length || 0;
    const nReg = state.fr?.regions.length || 0;
    let total = null;
    if (state.idx) {
      total = 0;
      Object.values(state.idx.totaux || {}).forEach((o) => Object.values(o).forEach((v) => (total += v || 0)));
    }
    const cards = [
      { n: nLu, l: `métiers très en pénurie au Luxembourg${state.lu?.source?.annee ? ` (${state.lu.source.annee})` : ""}` },
      { n: nFr, l: "métiers en tension en France" },
      { n: nReg, l: "régions françaises couvertes" },
      total !== null ? { n: nf.format(total), l: "offres en direct (France Travail)" } : { n: 8, l: "sites d'emploi reliés en un clic" },
    ];
    $("#stats").innerHTML = cards.map((c) => `<div class="stat"><div class="n">${c.n}</div><div class="l">${esc(c.l)}</div></div>`).join("");
  }

  function renderSectors() {
    const base = filtered({ ignoreSecteur: true });
    const counts = {};
    base.forEach((it) => (counts[it.secteur] = (counts[it.secteur] || 0) + 1));
    const ids = Object.keys(SECTEURS).filter((id) => counts[id]);
    if (state.secteur !== "all" && !counts[state.secteur]) state.secteur = "all";
    $("#sectors").innerHTML =
      `<button class="sector ${state.secteur === "all" ? "is-on" : ""}" data-sect="all"><span class="em">✨</span>Tous <span class="c">${base.length}</span></button>` +
      ids.map((id) => `<button class="sector ${state.secteur === id ? "is-on" : ""}" data-sect="${id}"><span class="em">${sect(id).em}</span>${esc(sect(id).label)} <span class="c">${counts[id]}</span></button>`).join("");
  }

  function renderGrid() {
    const list = filtered();
    const collator = new Intl.Collator("fr");
    list.sort((a, b) => {
      if (state.tri === "offres") return (offresCount(b) ?? -1) - (offresCount(a) ?? -1) || collator.compare(a.titre, b.titre);
      if (state.tri === "pays") return a.pays.localeCompare(b.pays) * -1 || collator.compare(a.titre, b.titre);
      return collator.compare(a.titre, b.titre);
    });
    const reg = regionById(state.region);
    $("#results-title").textContent = `${list.length} métier${list.length > 1 ? "s" : ""}${reg ? ` · ${reg.nom}` : ""}`;

    if (!list.length) {
      $("#grid").innerHTML = `<div class="empty"><div class="big">🔎</div><strong>Aucun métier trouvé</strong>Essayez un autre mot, ou retirez un filtre.</div>`;
      return;
    }
    $("#grid").innerHTML = list.map(card).join("");
  }

  function card(it) {
    const s = sect(it.secteur);
    const n = offresCount(it);
    let sub, foot;
    if (it.pays === "lu") {
      const ex = it.appellations.slice(0, 3).map((a) => a.court).join(", ");
      sub = `${it.appellations.length} intitulé${it.appellations.length > 1 ? "s" : ""} · ${ex}${it.appellations.length > 3 ? "…" : ""}`;
      foot = `<span class="region-n">Tout le Luxembourg</span>`;
    } else {
      const reg = regionById(state.region);
      sub = it.rome.slice(0, 3).map((r) => r.titre).join(" · ");
      foot = reg ? `<span class="region-n">${esc(reg.nom)}</span>` : `<span class="region-n">${it.regions.length} région${it.regions.length > 1 ? "s" : ""}</span>`;
    }
    const badge = n !== null ? `<span class="hot">🔥 ${nf.format(n)} offre${n > 1 ? "s" : ""}</span>` : foot;
    return `
      <button class="job" type="button" data-open="${esc(it.id)}">
        <div class="job-top">
          <span class="tile" style="${tileStyle(it.secteur)}">${s.em}</span>
          <div class="job-tags"><span class="cc ${it.pays}">${it.pays.toUpperCase()}</span><span class="code">${esc(it.code)}</span></div>
        </div>
        <h3>${esc(it.titre)}</h3>
        <p class="sub">${esc(sub)}</p>
        <div class="job-foot">${badge}<span class="go">Voir →</span></div>
      </button>`;
  }

  function renderExplorer() {
    renderSectors();
    renderGrid();
  }

  function initExplorer() {
    const qEl = $("#q");
    let t;
    qEl.addEventListener("input", () => {
      $("#q-clear").hidden = !qEl.value;
      clearTimeout(t);
      t = setTimeout(() => { state.q = qEl.value; renderExplorer(); }, 120);
    });
    $("#q-clear").addEventListener("click", () => { qEl.value = ""; state.q = ""; $("#q-clear").hidden = true; renderExplorer(); qEl.focus(); });

    $$(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      $$(".seg-btn").forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-checked", String(x === b)); });
      state.pays = b.dataset.pays;
      $("#region-wrap").hidden = state.pays === "lu";
      if (state.pays === "lu") state.region = "all", ($("#region").value = "all");
      renderExplorer();
    }));
    $("#region").addEventListener("change", (e) => { state.region = e.target.value; renderExplorer(); });
    $("#tri").addEventListener("change", (e) => { state.tri = e.target.value; renderGrid(); });
    $("#sectors").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sect]");
      if (!b) return;
      state.secteur = b.dataset.sect;
      renderExplorer();
    });
    $("#grid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) location.hash = `metier/${b.dataset.open}`;
    });
  }

  // ======================= Fiche métier =======================
  async function openDetail(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    const dlg = $("#detail");
    const s = sect(it.secteur);
    const src = it.pays === "lu" ? state.lu.source : state.fr.source;
    let region = it.pays === "fr" ? (it.regions.includes(state.region) ? state.region : bestRegion(it)) : null;
    let kw = it.motCle;

    const body = $("#detail-body");
    body.innerHTML = `
      <div class="sheet-head" style="margin-bottom:0">
        <div class="d-hero">
          <span class="tile" style="${tileStyle(it.secteur)}">${s.em}</span>
          <div>
            <div class="d-meta"><span class="cc ${it.pays}">${it.pays.toUpperCase()}</span><span class="code">${esc(it.code)}</span><span class="code">${esc(s.label)}</span></div>
            <h2 id="d-title">${esc(it.titre)}</h2>
            <p class="muted small">${it.pays === "lu" ? "Métier très en pénurie au Luxembourg" : `Métier en tension dans ${it.regions.length} région${it.regions.length > 1 ? "s" : ""}`}</p>
          </div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">×</button>
      </div>
      <div id="d-content"></div>`;

    const content = $("#d-content", body);
    const draw = () => {
      let html = "";
      if (it.pays === "lu") {
        html += `<div class="d-sec"><h3>Intitulés officiels (ADEM)</h3><div class="chips">${it.appellations.map((a) => `<button type="button" class="chip ${a.court === kw ? "is-on" : ""}" data-kw="${esc(a.court)}" title="${esc(a.nom)}">${esc(a.court)}</button>`).join("")}</div>
          ${it.exclues.length ? `<p class="hint">Non concerné : ${it.exclues.map(esc).join(", ")}.</p>` : ""}</div>`;
      } else {
        html += `<div class="d-sec"><h3>Régions où ce métier est en tension</h3><div class="chips">${it.regions.map((rid) => {
          const r = regionById(rid); const n = offresCount(it, rid);
          return `<button type="button" class="chip ${rid === region ? "is-on" : ""}" data-region="${rid}">${esc(r ? r.nom : rid)}${n !== null ? ` <span class="n">${nf.format(n)}</span>` : ""}</button>`;
        }).join("")}</div></div>`;
        html += `<div class="d-sec" id="d-offres"></div>`;
        html += `<div class="d-sec"><h3>Métiers correspondants (ROME)</h3><div class="chips">${it.rome.map((r) => `<button type="button" class="chip ${r.titre === kw ? "is-on" : ""}" data-kw="${esc(r.titre)}">${esc(r.titre)}</button>`).join("")}</div></div>`;
      }
      html += `
        <div class="d-sec">
          <h3>Chercher des offres${it.pays === "fr" && regionById(region) ? ` · ${esc(regionById(region).nom)}` : it.pays === "lu" ? " au Luxembourg" : ""}</h3>
          <div class="kw-row"><input id="d-kw" value="${esc(kw)}" aria-label="Mot-clé de recherche"></div>
          <div class="links">${liensRecherche(it, kw, region).map((l) => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${EXT}</a>`).join("")}</div>
          <p class="hint">Cliquez sur un intitulé ci-dessus pour l'utiliser comme mot-clé, ou tapez le vôtre.</p>
        </div>
        <div class="d-actions">
          <span class="muted small">Source : <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.titre)}</a></span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn sm ghost" id="d-share">Partager</button>
            <button type="button" class="btn sm primary" id="d-track">+ Suivre une candidature</button>
          </div>
        </div>`;
      content.innerHTML = html;
      if (it.pays === "fr") drawOffres(it, region);
    };

    content.addEventListener("click", (e) => {
      const k = e.target.closest("[data-kw]");
      if (k) { kw = k.dataset.kw; draw(); return; }
      const r = e.target.closest("[data-region]");
      if (r) { region = r.dataset.region; draw(); return; }
      if (e.target.closest("#d-track")) {
        dlg.close();
        openCand({ poste: kw, pays: it.pays, lieu: it.pays === "lu" ? "Luxembourg" : regionById(region)?.nom || "", statut: "a-postuler" });
      }
      if (e.target.closest("#d-share")) share(it);
    });
    content.addEventListener("input", (e) => {
      if (e.target.id !== "d-kw") return;
      kw = e.target.value.trim() || it.motCle;
      $$(".links a", content).forEach((a, i) => (a.href = liensRecherche(it, kw, region)[i].url));
      $$("[data-kw]", content).forEach((c) => c.classList.toggle("is-on", c.dataset.kw === kw));
    });

    draw();
    if (!dlg.open) dlg.showModal();
    body.scrollTop = 0;
  }

  function bestRegion(it) {
    if (!state.idx) return it.regions[0];
    return it.regions.slice().sort((a, b) => (offresCount(it, b) ?? -1) - (offresCount(it, a) ?? -1))[0];
  }

  async function drawOffres(it, regionId) {
    const box = $("#d-offres");
    if (!box) return;
    if (!state.idx) { box.remove(); return; }
    box.innerHTML = `<h3>Dernières offres</h3><div class="skeleton" style="height:120px"></div>`;
    if (!state.offresCache[regionId]) state.offresCache[regionId] = getJson(`data/offres/${regionId}.json`);
    const data = await state.offresCache[regionId];
    if (!document.body.contains(box)) return;
    const f = data?.familles?.[it.code];
    const r = regionById(regionId);
    if (!f) { box.innerHTML = `<h3>Dernières offres</h3><p class="callout">Pas de données d'offres pour cette région aujourd'hui.</p>`; return; }
    const voirTout = liensRecherche(it, it.motCle, regionId)[0].url;
    box.innerHTML = `
      <div class="offers-total"><h3 style="margin:0">Dernières offres · ${esc(r?.nom || "")}</h3><span class="hot">🔥 ${nf.format(f.total)} offre${f.total > 1 ? "s" : ""}</span></div>
      ${f.offres.length ? `<div class="offers">${f.offres.map((o) => `
        <a class="offer" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">
          <span class="t">${esc(o.titre)}</span>
          <span class="d">${esc(o.contrat || "")}<br>${esc(fmtDate(o.date))}</span>
          <span class="m">${esc([o.entreprise, o.lieu].filter(Boolean).join(" · "))}</span>
        </a>`).join("")}</div>
        <p class="hint"><a href="${esc(voirTout)}" target="_blank" rel="noopener">Voir toutes les offres sur France Travail →</a> · mis à jour ${esc(fmtDate((data.majLe || "").slice(0, 10)))}</p>`
        : `<p class="callout">Aucune offre publiée en ce moment sur France Travail pour ce métier dans cette région.</p>`}`;
  }

  async function share(it) {
    const url = `${location.origin}${location.pathname}#metier/${it.id}`;
    const data = { title: it.titre, text: `${it.titre} — métier en tension (${it.pays === "lu" ? "Luxembourg" : "France"})`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); toast("Lien copié"); }
    } catch (e) { /* partage annulé */ }
  }

  function initDialogs() {
    $$("dialog").forEach((d) => {
      d.addEventListener("click", (e) => {
        if (e.target === d || e.target.closest("[data-close]")) d.close();
      });
    });
    $("#detail").addEventListener("close", () => {
      if (location.hash.startsWith("#metier/")) history.replaceState(null, "", location.pathname + location.search);
    });
  }

  // ======================= Télétravail =======================
  async function loadRemote() {
    if (!state.remoteLoading) state.remoteLoading = getJson("data/teletravail.json").then((d) => (state.remote = d));
    return state.remoteLoading;
  }

  function remoteFiltered({ ignore } = {}) {
    const words = norm(state.rq).split(/\s+/).filter(Boolean);
    const z = R_ZONES.find((x) => x.id === state.rZone)?.zones;
    return (state.remote?.offres || []).filter((o) => {
      if (ignore !== "zone" && z && !z.includes(o.zone)) return false;
      if (ignore !== "type" && state.rType !== "all" && o.type !== state.rType) return false;
      if (ignore !== "cat" && state.rCat !== "all" && o.categorie !== state.rCat) return false;
      if (!words.length) return true;
      const hay = o._hay || (o._hay = norm([o.titre, o.entreprise, o.lieu, ...(o.tags || [])].join(" ")));
      return words.every((w) => hay.includes(w));
    });
  }

  async function renderRemote() {
    const list = $("#r-list");
    if (!state.remote) {
      list.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton" style="height:96px"></div>`).join("");
      await loadRemote();
      if (!state.remote) { list.innerHTML = `<div class="empty"><div class="big">⚠️</div><strong>Offres indisponibles</strong>Réessayez dans un instant.</div>`; return; }
    }
    const count = (arr, key) => arr.reduce((m, o) => ((m[o[key]] = (m[o[key]] || 0) + 1), m), {});

    const byZone = remoteFiltered({ ignore: "zone" });
    $("#r-zone").innerHTML = R_ZONES.map((z) => {
      const n = z.zones ? byZone.filter((o) => z.zones.includes(o.zone)).length : byZone.length;
      return `<button type="button" class="chip ${state.rZone === z.id ? "is-on" : ""}" data-rzone="${z.id}">${esc(z.label)} · ${n}</button>`;
    }).join("");

    const types = count(remoteFiltered({ ignore: "type" }), "type");
    $("#r-type").innerHTML = `<button type="button" class="chip ${state.rType === "all" ? "is-on" : ""}" data-rtype="all">Tous</button>` +
      Object.keys(R_TYPES).filter((t) => types[t]).map((t) => `<button type="button" class="chip ${state.rType === t ? "is-on" : ""}" data-rtype="${t}">${esc(R_TYPES[t])} · ${types[t]}</button>`).join("");

    const cats = count(remoteFiltered({ ignore: "cat" }), "categorie");
    if (state.rCat !== "all" && !cats[state.rCat]) state.rCat = "all";
    const totalCat = Object.values(cats).reduce((a, b) => a + b, 0);
    $("#r-cat").innerHTML = `<button class="sector ${state.rCat === "all" ? "is-on" : ""}" data-rcat="all"><span class="em">✨</span>Toutes <span class="c">${totalCat}</span></button>` +
      Object.keys(R_CATS).filter((c) => cats[c]).map((c) => `<button class="sector ${state.rCat === c ? "is-on" : ""}" data-rcat="${c}"><span class="em">${R_CATS[c].em}</span>${esc(R_CATS[c].label)} <span class="c">${cats[c]}</span></button>`).join("");

    const items = remoteFiltered();
    $("#r-title").textContent = `${nf.format(items.length)} offre${items.length > 1 ? "s" : ""} en télétravail`;
    $("#r-maj").textContent = state.remote.majLe ? `Mis à jour le ${fmtDate(state.remote.majLe.slice(0, 10))}` : "";
    const srcs = state.remote.sources || {};
    $("#r-sources").innerHTML = Object.values(srcs).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.nom)}</a>`).join(", ");

    if (!items.length) {
      list.innerHTML = `<div class="empty"><div class="big">🔎</div><strong>Aucune offre ne correspond</strong>Essayez « Toutes les offres » ou un autre mot-clé.</div>`;
      $("#r-more").hidden = true;
      return;
    }
    list.innerHTML = items.slice(0, state.rShown).map((o) => remoteCard(o, srcs)).join("");
    $("#r-more").hidden = items.length <= state.rShown;
  }

  function remoteCard(o, srcs) {
    const src = srcs[o.source] || { nom: o.source, url: "#" };
    const url = safeUrl(o.url);
    return `
      <article class="rjob" data-rid="${esc(o.id)}">
        <span class="avatar" style="background:${avatarColor(o.entreprise || o.titre)}">${esc((o.entreprise || o.titre || "?").trim().charAt(0).toUpperCase())}</span>
        <h3>${esc(o.titre)}</h3>
        <div class="rjob-actions">
          <button type="button" class="btn ghost sm" data-rtrack>+ Suivre</button>
          ${url ? `<a class="btn primary sm" href="${esc(url)}" target="_blank" rel="noopener">Postuler ${EXT}</a>` : ""}
        </div>
        <div class="meta">
          ${o.entreprise ? `<strong style="color:var(--text-2)">${esc(o.entreprise)}</strong>` : ""}
          ${o.lieu ? `<span>📍 ${esc(o.lieu)}</span>` : ""}
          ${o.date ? `<span>${esc(fmtDate(o.date))}</span>` : ""}
          <span class="via">via <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.nom)}</a></span>
        </div>
        <div class="tags">
          <span class="tag ${esc(o.type)}">${esc(R_TYPES[o.type] || o.type)}</span>
          ${o.zone === "monde" ? `<span class="tag monde">Monde entier</span>` : ""}
          ${o.salaire ? `<span class="tag money">${esc(o.salaire)}</span>` : ""}
          ${R_CATS[o.categorie] ? `<span class="tag">${R_CATS[o.categorie].em} ${esc(R_CATS[o.categorie].label)}</span>` : ""}
        </div>
      </article>`;
  }

  function initRemote() {
    let t;
    $("#rq").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.rq = e.target.value; state.rShown = 30; renderRemote(); }, 120);
    });
    document.querySelector('[data-view="teletravail"]').addEventListener("click", (e) => {
      const z = e.target.closest("[data-rzone]"), ty = e.target.closest("[data-rtype]"), c = e.target.closest("[data-rcat]");
      if (z) state.rZone = z.dataset.rzone;
      if (ty) state.rType = ty.dataset.rtype;
      if (c) state.rCat = c.dataset.rcat;
      if (z || ty || c) { state.rShown = 30; renderRemote(); return; }
      if (e.target.closest("#r-more")) { state.rShown += 30; renderRemote(); return; }
      if (e.target.closest("[data-rtrack]")) {
        const o = (state.remote?.offres || []).find((x) => x.id === e.target.closest(".rjob").dataset.rid);
        if (o) openCand({ entreprise: o.entreprise || "", poste: o.titre, pays: "remote", lieu: o.lieu || "Télétravail", lien: o.url, statut: "a-postuler" });
      }
    });
  }

  // ======================= Candidatures =======================
  function saveCands() {
    if (!store.set(STORE, state.cands)) toast("Impossible d'enregistrer dans ce navigateur — pensez à exporter.");
    renderBadge();
  }
  function renderBadge() {
    const b = $("#badge-count");
    b.textContent = state.cands.length;
    b.hidden = !state.cands.length;
  }
  const avatarColor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 62% 52%)`; };

  function renderSuivi() {
    const all = state.cands;
    const cnt = (ids) => all.filter((c) => ids.includes(c.statut)).length;
    const kpis = [
      { n: all.length, l: "Candidatures", accent: true },
      { n: cnt(["a-postuler"]), l: "À postuler" },
      { n: cnt(["postule", "relance"]), l: "En attente" },
      { n: cnt(["entretien"]), l: "Entretiens" },
      { n: cnt(["offre"]), l: "Offres reçues" },
    ];
    $("#kpis").innerHTML = kpis.map((k) => `<div class="kpi ${k.accent ? "accent" : ""}"><div class="n">${k.n}</div><div class="l">${k.l}</div></div>`).join("");

    $("#status-filter").innerHTML = [{ id: "all", label: "Toutes" }, ...STATUTS]
      .map((s) => `<button type="button" class="chip ${state.filtreStatut === s.id ? "is-on" : ""}" data-st="${s.id}">${s.label}${s.id !== "all" && cnt([s.id]) ? ` · ${cnt([s.id])}` : ""}</button>`).join("");

    const items = state.filtreStatut === "all" ? all : all.filter((c) => c.statut === state.filtreStatut);
    const list = $("#cand-list");
    if (!items.length) {
      list.innerHTML = all.length
        ? `<div class="empty"><div class="big">🗂️</div><strong>Rien dans ce statut</strong>Choisissez un autre filtre.</div>`
        : `<div class="empty"><div class="big">🚀</div><strong>Aucune candidature pour l'instant</strong>Ouvrez un métier dans « Explorer » et cliquez sur « + Suivre une candidature », ou ajoutez-en une directement.</div>`;
      return;
    }
    list.innerHTML = items.map((c) => `
      <article class="cand" data-id="${esc(c.id)}">
        <span class="avatar" style="background:${avatarColor(c.entreprise)}">${esc((c.entreprise || "?").trim().charAt(0).toUpperCase())}</span>
        <h3>${esc(c.poste)}</h3>
        <div class="cand-actions">
          <select class="status-select st-${esc(c.statut)}" data-act="statut" aria-label="Statut">
            ${STATUTS.map((s) => `<option value="${s.id}" ${s.id === c.statut ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
          <button type="button" class="btn ghost sm" data-act="edit">Modifier</button>
          <button type="button" class="btn ghost sm danger" data-act="del">Supprimer</button>
        </div>
        <div class="meta">
          <strong style="color:var(--text-2)">${esc(c.entreprise)}</strong>
          <span><span class="cc ${PAYS[c.pays] ? c.pays : "lu"}">${(PAYS[c.pays] || PAYS.lu).cc}</span> ${esc(c.lieu || (PAYS[c.pays] || PAYS.lu).nom)}</span>
          ${c.date ? `<span>${esc(fmtDate(c.date))}</span>` : ""}
          ${safeUrl(c.lien) ? `<a href="${esc(safeUrl(c.lien))}" target="_blank" rel="noopener">Voir l'offre ↗</a>` : ""}
        </div>
        ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}
      </article>`).join("");
  }

  function openCand(data = {}) {
    $("#cand-title").textContent = data.id ? "Modifier la candidature" : "Nouvelle candidature";
    $("#f-id").value = data.id || "";
    $("#f-entreprise").value = data.entreprise || "";
    $("#f-poste").value = data.poste || "";
    $("#f-pays").value = data.pays || "lu";
    $("#f-lieu").value = data.lieu || "";
    $("#f-statut").value = data.statut || "a-postuler";
    $("#f-date").value = data.date || today();
    $("#f-lien").value = data.lien || "";
    $("#f-notes").value = data.notes || "";
    $("#cand-dialog").showModal();
    (data.poste && !data.entreprise ? $("#f-entreprise") : $("#f-poste")).focus();
  }

  function initSuivi() {
    STATUTS.forEach((s) => $("#f-statut").add(new Option(s.label, s.id)));
    $("#btn-new").addEventListener("click", () => openCand());

    $("#cand-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const entry = {
        id: $("#f-id").value || uid(),
        entreprise: $("#f-entreprise").value.trim(),
        poste: $("#f-poste").value.trim(),
        pays: $("#f-pays").value,
        lieu: $("#f-lieu").value.trim(),
        statut: $("#f-statut").value,
        date: $("#f-date").value,
        lien: safeUrl($("#f-lien").value.trim()),
        notes: $("#f-notes").value.trim(),
        maj: new Date().toISOString(),
      };
      if (!entry.entreprise || !entry.poste) return;
      const i = state.cands.findIndex((c) => c.id === entry.id);
      if (i >= 0) state.cands[i] = entry; else state.cands.unshift(entry);
      saveCands();
      $("#cand-dialog").close();
      toast(i >= 0 ? "Candidature mise à jour" : "Candidature ajoutée");
      if (location.hash !== "#suivi") location.hash = "suivi"; else renderSuivi();
    });

    $("#status-filter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-st]");
      if (b) { state.filtreStatut = b.dataset.st; renderSuivi(); }
    });

    $("#cand-list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const id = b.closest(".cand").dataset.id;
      const c = state.cands.find((x) => x.id === id);
      if (!c) return;
      if (b.dataset.act === "edit") openCand(c);
      if (b.dataset.act === "del") {
        if (b.dataset.confirm) {
          state.cands = state.cands.filter((x) => x.id !== id);
          saveCands(); renderSuivi(); toast("Candidature supprimée");
        } else {
          b.dataset.confirm = "1"; b.textContent = "Confirmer ?";
          setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = "Supprimer"; } }, 3000);
        }
      }
    });
    $("#cand-list").addEventListener("change", (e) => {
      if (!e.target.matches("[data-act=statut]")) return;
      const c = state.cands.find((x) => x.id === e.target.closest(".cand").dataset.id);
      if (!c) return;
      c.statut = e.target.value;
      if (c.statut === "postule" && !c.date) c.date = today();
      c.maj = new Date().toISOString();
      saveCands(); renderSuivi();
    });

    $("#btn-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state.cands, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `candidatures-${today()}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("#btn-import").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error();
          const known = new Set(state.cands.map((c) => c.id));
          let n = 0;
          data.forEach((c) => {
            if (!c || typeof c !== "object" || !c.entreprise || !c.poste) return;
            const entry = {
              id: String(c.id || uid()), entreprise: String(c.entreprise), poste: String(c.poste),
              pays: PAYS[c.pays] ? c.pays : "lu", lieu: String(c.lieu || ""),
              statut: statutLabel[c.statut] ? c.statut : "a-postuler",
              date: /^\d{4}-\d{2}-\d{2}$/.test(c.date || "") ? c.date : "",
              lien: safeUrl(c.lien || ""), notes: String(c.notes || ""), maj: String(c.maj || new Date().toISOString()),
            };
            if (known.has(entry.id)) return;
            state.cands.push(entry); known.add(entry.id); n++;
          });
          saveCands(); renderSuivi(); toast(`${n} candidature(s) importée(s)`);
        } catch (err) {
          toast("Fichier invalide : utilisez un export de ce site.");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
  }

  // ======================= Routage =======================
  function route() {
    const h = location.hash.replace(/^#/, "");
    const view = ["suivi", "apropos", "teletravail"].includes(h) ? h : "explorer";
    $$("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== view));
    $$(".nav-link").forEach((a) => a.classList.toggle("is-on", a.dataset.route === view));
    if (view === "suivi") renderSuivi();
    if (view === "teletravail") renderRemote();
    if (h.startsWith("metier/")) openDetail(h.slice(7));
    else if ($("#detail").open) $("#detail").close();
    if (!h.startsWith("metier/")) window.scrollTo({ top: 0 });
  }

  // ======================= Démarrage =======================
  function renderSources() {
    const lu = state.lu?.source, fr = state.fr?.source;
    if (lu) $("#src-lu").innerHTML = `Source : <a href="${esc(lu.url)}" target="_blank" rel="noopener">${esc(lu.titre)}</a>${lu.reference ? `<br>${esc(lu.reference)}` : ""}`;
    if (fr) $("#src-fr").innerHTML = `Source : <a href="${esc(fr.url)}" target="_blank" rel="noopener">${esc(fr.titre)}</a>${fr.nor ? `<br>NOR ${esc(fr.nor)}` : ""}`;
    const dates = [
      lu && `liste luxembourgeoise mise à jour le ${fmtDate(state.lu.majLe.slice(0, 10))}`,
      fr && `liste française le ${fmtDate(state.fr.majLe.slice(0, 10))}`,
      state.idx && `offres le ${fmtDate(state.idx.majLe.slice(0, 10))}`,
    ].filter(Boolean);
    $("#maj-info").textContent = dates.length ? `Dernières mises à jour : ${dates.join(", ")}.` : "";
    $("#foot-maj").textContent = state.idx ? `Offres actualisées le ${fmtDate(state.idx.majLe.slice(0, 10))}` : "";
  }

  async function init() {
    $("#grid").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
    initExplorer(); initSuivi(); initRemote(); initDialogs(); renderBadge();
    $$("[data-route]").forEach((a) => a.addEventListener("click", (e) => {
      if (a.dataset.route === "explorer") { e.preventDefault(); history.pushState(null, "", location.pathname); route(); }
    }));
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);

    [state.lu, state.fr, state.idx] = await Promise.all([getJson("data/lu.json"), getJson("data/fr.json"), getJson("data/offres/index.json")]);
    if (!state.lu && !state.fr) {
      $("#grid").innerHTML = `<div class="empty"><div class="big">⚠️</div><strong>Données indisponibles</strong>Réessayez dans un instant.</div>`;
      return;
    }
    (state.fr?.regions || []).forEach((r) => $("#region").add(new Option(r.nom, r.id)));
    buildItems();
    renderStats();
    renderSources();
    renderExplorer();
    route();
  }

  init();
})();
