// Télétravail & freelance : collecte les offres 100 % à distance de sources publiques
// (Remotive, Remote OK, Himalayas, Jobicy, We Work Remotely) et les enregistre en JSON.
// Aucune clé nécessaire. Conditions des sources : citer la source, renvoyer vers l'offre
// d'origine sans modifier le lien, retirer les offres expirées, ne pas redistribuer à d'autres
// sites d'emploi ; appels limités (une fois par jour ici).
// Usage : node scripts/update-teletravail.mjs
import { join } from "node:path";
import { DATA_DIR, fail, fetchRetry, norm, nowIso, sleep, writeJsonIfChanged } from "./lib.mjs";

const UA = { "User-Agent": "metiers-tension (site d'information ; une requête par jour)", Accept: "application/json" };
const MAX_JOURS = 60;
const MAX_OFFRES = 1500;

export const SOURCES = {
  remotive: { nom: "Remotive", url: "https://remotive.com" },
  remoteok: { nom: "Remote OK", url: "https://remoteok.com" },
  himalayas: { nom: "Himalayas", url: "https://himalayas.app" },
  jobicy: { nom: "Jobicy", url: "https://jobicy.com" },
  wwr: { nom: "We Work Remotely", url: "https://weworkremotely.com" },
};

// ---------- Normalisation ----------
function typeContrat(raw) {
  const s = norm([].concat(raw || []).join(" "));
  if (/freelance/.test(s)) return "freelance";
  if (/contract|contrat|temporary/.test(s)) return "contrat";
  if (/part[ _-]?time|partiel/.test(s)) return "temps-partiel";
  if (/intern|stage/.test(s)) return "stage";
  return "temps-plein";
}

// Zone géographique d'où l'on peut postuler.
function zone(loc) {
  const s = norm(loc);
  if (!s) return "inconnue";
  if (/worldwide|anywhere|global|world ?wide|international|^remote$|all countries/.test(s)) return "monde";
  if (/africa|afrique|madagascar|emea|middle east/.test(s)) return "afrique";
  if (/europe|\beu\b|\beea\b|\bcet\b|\bcest\b|united kingdom|\buk\b|france|germany|spain|portugal|ireland|netherlands|belgium|luxembourg|poland|italy|sweden|denmark|norway|finland|austria|switzerland|czech|romania|greece|hungary|bulgaria|croatia|estonia|latvia|lithuania|serbia|ukraine/.test(s)) return "europe";
  return "autre";
}

// L'ordre compte : « Business Development » est un métier de vente, pas de développement logiciel.
const CATEGORIES = [
  ["ventes", /sales|business development|account (executive|manager)|commercial/],
  ["data", /\bdata\b|machine learning|\bml\b|\bai\b|artificial intelligence|analytics|scientist/],
  ["design", /design|\bux\b|\bui\b|graphic|creative|illustrat|video|animation/],
  ["marketing", /marketing|seo|growth|social media|content|community|brand/],
  ["redaction", /writ|copy|editor|translat|transcri|journalis/],
  ["support", /customer|support|success|service client/],
  ["dev", /software|developer|engineer|programming|devops|backend|frontend|front-end|back-end|full[ -]?stack|mobile|\bqa\b|tester|sysadmin|cloud|security|\bweb\b/],
  ["finance", /finance|account(ing|ant)|bookkeep|legal|admin|operations|project manag|product manag|\bhr\b|human resources|recruit/],
];
function categorie(...textes) {
  const s = norm(textes.flat().filter(Boolean).join(" "));
  for (const [id, re] of CATEGORIES) if (re.test(s)) return id;
  return "autres";
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const isoDate = (v) => {
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
function salaire(min, max, devise = "") {
  const f = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  if (min && max && f(min) !== f(max)) return `${f(min)}–${f(max)} ${devise}`.trim();
  if (min || max) return `${f(min || max)} ${devise}`.trim();
  return null;
}

// ---------- Analyse de la description (règles fixes, sans IA) ----------
// La description n'est pas stockée : on n'en garde que des indices utiles au tri.
const TECHS = [
  [".NET", /\.net\b|dotnet|asp\.net/i], ["C#", /c#|\bcsharp\b/i], ["Java", /\bjava\b(?!\s*script)/i],
  ["Spring", /\bspring\b/i], ["Python", /\bpython\b/i], ["Django", /\bdjango\b/i], ["Odoo", /\bodoo\b/i],
  ["TypeScript", /\btypescript\b/i], ["JavaScript", /\bjavascript\b/i], ["React", /\breact(?!\s*native)\b/i],
  ["React Native", /\breact\s*native\b/i], ["Vue.js", /\bvue(\.?js)?\b/i], ["Angular", /\bangular\b/i],
  ["Node.js", /\bnode(\.?js)?\b/i], ["PHP", /\bphp\b/i], ["Laravel", /\blaravel\b/i], ["Ruby", /\bruby\b|\brails\b/i],
  ["Kotlin", /\bkotlin\b/i], ["Swift", /\bswift\b/i], ["Flutter", /\bflutter\b/i], ["Go", /\bgolang\b/i],
  ["SQL", /\bsql\b/i], ["PostgreSQL", /\bpostgres(ql)?\b/i], ["SQL Server", /sql server|\bmssql\b/i],
  ["MongoDB", /\bmongo(db)?\b/i], ["Docker", /\bdocker\b/i], ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["AWS", /\baws\b/i], ["Azure", /\bazure\b/i], ["GCP", /\bgcp\b|google cloud/i], ["Supabase", /\bsupabase\b/i],
  ["Firebase", /\bfirebase\b/i],
];
// Offres présentées comme « remote » mais en réalité sur place ou hybrides.
// Les négations (« very few office-based roles », « no on-site work ») ne comptent pas.
const FAUX_TELETRAVAIL = /(?<!(few|no|non|not|without) )(hybrid (role|position|work|working|model|schedule)|on-?site (role|position|work)|office-based (role|position))|\b(this|the) (role|position|job) is (office-based|on-?site|hybrid)|work(ing)? (from|in|at) (our|the) office (\d|one|two|three|four) days|\b(one|1|two|2|three|3|four|4) days? (a|per) week (in|at|from) (the |our )?office|\b(one|1) day (a|per) week[^.]{0,30}(home|wfh|remote)|\bwfh[^.]{0,30}\b(one|1) day/i;

function analyser(html) {
  const txt = String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  if (!txt.trim()) return {};
  const exp = txt.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs)\b[^.]{0,40}experience/i);
  return {
    techs: TECHS.filter(([, re]) => re.test(txt)).map(([nom]) => nom),
    horsTeletravail: FAUX_TELETRAVAIL.test(txt) || undefined,
    experience: exp ? Number(exp[1]) : undefined,
  };
}

function offre(o) {
  const titre = clean(o.titre);
  const url = clean(o.url);
  if (!titre || !/^https:\/\//.test(url)) return null;
  const lieu = clean(o.lieu) || null;
  const a = analyser(o.description);
  return {
    ...(a.techs?.length ? { techs: a.techs } : {}),
    ...(a.horsTeletravail ? { horsTeletravail: true } : {}),
    ...(a.experience ? { experience: a.experience } : {}),
    id: `${o.source}-${o.id}`,
    source: o.source,
    titre,
    entreprise: clean(o.entreprise) || null,
    lieu,
    zone: o.zone || zone(lieu),
    type: o.type,
    categorie: o.categorie,
    salaire: clean(o.salaire) || null,
    tags: (o.tags || []).map(clean).filter(Boolean).slice(0, 5),
    date: o.date,
    expire: o.expire || null,
    url,
  };
}

// ---------- Sources ----------
async function getJson(url, label) {
  const res = await fetchRetry(url, { headers: UA }, { label });
  if (!res.ok) throw new Error(`${label} : HTTP ${res.status}`);
  return res.json();
}

async function remotive() {
  const j = await getJson("https://remotive.com/api/remote-jobs", "Remotive");
  return (j.jobs || []).map((x) => offre({
    source: "remotive", id: x.id, titre: x.title, entreprise: x.company_name, lieu: x.candidate_required_location,
    type: typeContrat(x.job_type), categorie: categorie(x.category, x.title), salaire: x.salary, tags: x.tags,
    date: isoDate(x.publication_date), url: x.url, description: x.description,
  }));
}

async function remoteok() {
  const j = await getJson("https://remoteok.com/api", "Remote OK");
  return j.filter((x) => x && x.id && x.position).map((x) => offre({
    source: "remoteok", id: x.id, titre: x.position, entreprise: x.company, lieu: x.location,
    type: typeContrat(x.tags), categorie: categorie(x.tags, x.position),
    salaire: avecPeriode(salaire(x.salary_min, x.salary_max, "USD"), "annual"), tags: x.tags,
    date: isoDate(x.date || x.epoch), url: x.url, description: x.description,
  }));
}

function himalayasOffre(x) {
  const restr = x.locationRestrictions || [];
  return offre({
    source: "himalayas", id: x.guid || x.applicationLink, titre: x.title, entreprise: x.companyName,
    lieu: restr.length ? restr.join(", ") : "Worldwide", zone: restr.length ? zone(restr.join(", ")) : "monde",
    type: typeContrat(x.employmentType), categorie: categorie(x.parentCategories, x.categories?.slice(0, 3), x.title),
    salaire: avecPeriode(salaire(x.minSalary, x.maxSalary, x.currency || ""), x.salaryPeriod), tags: x.parentCategories,
    date: isoDate(x.pubDate), expire: x.expiryDate ? isoDate(x.expiryDate) : null, url: x.applicationLink || x.guid, description: x.description || x.excerpt,
  });
}

function avecPeriode(s, periode) {
  if (!s) return s;
  const p = { hourly: "/h", hour: "/h", daily: "/jour", day: "/jour", weekly: "/sem.", monthly: "/mois", month: "/mois", annual: "/an", yearly: "/an", year: "/an" }[String(periode || "").toLowerCase()];
  return p ? `${s} ${p}` : s;
}

async function himalayas() {
  const out = [];
  // 1) Offres ouvertes au monde entier (recherche « worldwide »).
  for (let page = 0; page < 15; page++) {
    const j = await getJson(`https://himalayas.app/jobs/api/search?worldwide=true&limit=20&offset=${page * 20}`, "Himalayas (monde)");
    out.push(...(j.jobs || []).map(himalayasOffre));
    if (!j.jobs?.length || (page + 1) * 20 >= (j.totalCount || 0)) break;
    await sleep(1500);
  }
  // 2) Dernières offres toutes zones (Europe, etc.).
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    await sleep(1500);
    const j = await getJson(`https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "Himalayas");
    out.push(...(j.jobs || []).map(himalayasOffre));
    cursor = j.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// We Work Remotely : flux RSS public (« Anyone can use the feed, all we ask is that you
// attribute the links back to We Work Remotely »).
async function wwr() {
  const res = await fetchRetry("https://weworkremotely.com/remote-jobs.rss", { headers: { ...UA, Accept: "application/rss+xml" } }, { label: "We Work Remotely" });
  if (!res.ok) throw new Error(`We Work Remotely : HTTP ${res.status}`);
  const xml = await res.text();
  const tag = (item, name) => {
    const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const full = tag(item, "title"); // « Entreprise: Poste »
    const i = full.indexOf(": ");
    const region = tag(item, "region");
    return offre({
      source: "wwr", id: tag(item, "guid") || tag(item, "link"),
      titre: i > 0 ? full.slice(i + 2) : full, entreprise: i > 0 ? full.slice(0, i) : null,
      lieu: /anywhere/i.test(region) ? region : [region, tag(item, "country")].filter(Boolean).join(" – "),
      zone: /anywhere/i.test(region) ? "monde" : zone(region),
      type: typeContrat(tag(item, "type")), categorie: categorie(tag(item, "category"), full),
      tags: [tag(item, "category")], date: isoDate(tag(item, "pubDate")), url: tag(item, "link"), description: tag(item, "description"),
    });
  });
}

async function jobicy() {
  const j = await getJson("https://jobicy.com/api/v2/remote-jobs?count=100&geo=anywhere", "Jobicy");
  return (j.jobs || []).map((x) => offre({
    source: "jobicy", id: x.id, titre: x.jobTitle, entreprise: x.companyName, lieu: x.jobGeo,
    type: typeContrat(x.jobType), categorie: categorie(x.jobIndustry, x.jobTitle),
    salaire: avecPeriode(salaire(x.annualSalaryMin, x.annualSalaryMax, x.salaryCurrency || ""), "annual"), tags: x.jobIndustry,
    date: isoDate(x.pubDate), url: x.url, description: x.jobDescription || x.jobExcerpt,
  }));
}

// ---------- Programme ----------
async function main() {
  const resultats = await Promise.allSettled([remotive(), remoteok(), himalayas(), jobicy(), wwr()]);
  const ids = Object.keys(SOURCES);
  const toutes = [];
  const ok = [];
  resultats.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const n = r.value.filter(Boolean);
      toutes.push(...n);
      ok.push(ids[i]);
      console.log(`  ${SOURCES[ids[i]].nom} : ${n.length} offres`);
    } else console.warn(`⚠ ${SOURCES[ids[i]].nom} : ${r.reason?.message}`);
  });
  if (!ok.length) fail("Télétravail : aucune source n'a répondu, données actuelles conservées.");

  const limite = new Date(Date.now() - MAX_JOURS * 864e5).toISOString().slice(0, 10);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const vues = new Set();
  const offres = toutes
    .filter((o) => (!o.date || o.date >= limite) && (!o.expire || o.expire >= aujourdhui))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .filter((o) => {
      const k = `${norm(o.titre)}|${norm(o.entreprise)}`;
      if (vues.has(k)) return false;
      vues.add(k);
      return true;
    })
    .slice(0, MAX_OFFRES);

  const changed = writeJsonIfChanged(join(DATA_DIR, "teletravail.json"), {
    majLe: nowIso(),
    sources: SOURCES,
    offres,
  });
  console.log(`✔ Télétravail : ${offres.length} offres (${ok.length}/${ids.length} sources)${changed ? " — mis à jour" : " — inchangé"}`);
}

main().catch((e) => fail(e.message));
