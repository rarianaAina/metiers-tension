// France : récupère le dernier arrêté « fixant la liste des métiers et zones géographiques
// caractérisés par des difficultés de recrutement » et l'enregistre en JSON.
//
// Usage :
//   node scripts/update-fr.mjs                 -> via l'API Légifrance (PISTE_CLIENT_ID / PISTE_CLIENT_SECRET)
//   node scripts/update-fr.mjs --pdf <fichier|url> [--url <lien légifrance>]  -> depuis le PDF du JO
//   node scripts/update-fr.mjs --force         -> ré-analyse même si l'arrêté n'a pas changé
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_DIR, REGIONS_FR, fail, fetchRetry, htmlToText, norm, nowIso, pdfToText, readJson,
  regionFromHeading, secteurFromFap, writeJsonIfChanged,
} from "./lib.mjs";

const OUT = join(DATA_DIR, "fr.json");
// PISTE_ENV=sandbox pour utiliser une application PISTE de test (par défaut : production).
const SANDBOX = /^sandbox$/i.test(process.env.PISTE_ENV || "");
const TOKEN_URL = SANDBOX ? "https://sandbox-oauth.piste.gouv.fr/api/oauth/token" : "https://oauth.piste.gouv.fr/api/oauth/token";
const API = `${SANDBOX ? "https://sandbox-api.piste.gouv.fr" : "https://api.piste.gouv.fr"}/dila/legifrance/lf-engine-app`;
const TITRE_RECHERCHE = "liste des métiers et zones géographiques caractérisés par des difficultés de recrutement";

const FAP = /^\s{0,3}([A-Z]\d[A-Z]\d{2})\s+(.*)$/; // annexe II : code en début de ligne
const FAP_I = /^\s*([A-Z]\d[A-Z]\d{2})\s+(.*)$/; // annexe I : les tableaux peuvent être indentés
const ROME = /(?:^|\s)([A-N]\d{4})\s+(.+?)(?=\s{2,}|$)/g;
const clean = (s) => s.replace(/\s*\(\*+\)/g, "").replace(/\s+/g, " ").trim();

// Analyse le texte de l'arrêté (issu du PDF ou de l'API) :
//  - annexe I : titres de régions suivis de lignes « CODE_FAP Famille professionnelle » ;
//  - annexe II : tableau « CODE_FAP Famille | CODE_ROME Métier », une correspondance par ligne.
// Dans le PDF, les deux colonnes de l'annexe II sont parfois décalées verticalement : on relève
// donc la suite des codes FAP et la suite des codes ROME séparément, puis on les associe dans l'ordre.
export function parseArrete(text) {
  const lines = text.replace(/\r/g, "").replace(/\f/g, "\n").split("\n");
  let debut2 = lines.findIndex((l) => /^\s*ANNEXE\s+II\b/i.test(l));
  if (debut2 < 0) debut2 = lines.findIndex((l) => FAP.test(l) && /\s[A-N]\d{4}\s/.test(l));
  if (debut2 < 0) debut2 = lines.length;

  // Annexe I
  const familles = new Map();
  let region = null;
  for (const line of lines.slice(0, debut2)) {
    const heading = regionFromHeading(line);
    if (heading) {
      region = heading.id;
      continue;
    }
    const f = line.match(FAP_I);
    if (f && region) {
      if (!familles.has(f[1])) familles.set(f[1], { code: f[1], titre: clean(f[2]), secteur: secteurFromFap(f[1]), regions: [], rome: [] });
      const fam = familles.get(f[1]);
      if (!fam.regions.includes(region)) fam.regions.push(region);
    }
  }

  // Annexe II
  const faps = [];
  const romes = [];
  let last = null; // dernier code ROME, pour les intitulés sur plusieurs lignes
  for (const line of lines.slice(debut2)) {
    const f = line.match(FAP);
    if (f) faps.push(f[1]);
    const found = [...line.matchAll(ROME)].filter((m) => !f || m.index > 0);
    if (found.length) {
      for (const m of found) {
        const r = { code: m[1], titre: clean(m[2]) };
        romes.push(r);
        last = { r, col: m.index + m[0].indexOf(m[1]) };
      }
    } else if (last && line.trim()) {
      const right = [...line.matchAll(/\S+(?: \S+)*/g)].filter((s) => s.index >= last.col - 3);
      if (right.length) last.r.titre = clean(`${last.r.titre} ${right.map((s) => s[0]).join(" ")}`);
    } else last = null;
  }
  if (faps.length !== romes.length) {
    throw new Error(`annexe II incohérente : ${faps.length} codes FAP pour ${romes.length} codes ROME`);
  }
  faps.forEach((code, i) => {
    const fam = familles.get(code);
    if (fam && !fam.rome.some((r) => r.code === romes[i].code)) fam.rome.push(romes[i]);
  });

  return [...familles.values()];
}

function meta(text) {
  const t = text.replace(/\s+/g, " ");
  return {
    titre: (t.match(/(Arrêté du \d{1,2}(?:er)? \S+ \d{4})/) || [])[1] || null,
    nor: (t.match(/NOR\s*:\s*([A-Z0-9]+)/) || [])[1] || null,
    eli: (t.match(/ELI\s*:\s*(https:\/\/\S+)/) || [])[1] || null,
  };
}

// ---------- API Légifrance (PISTE) ----------
async function token() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.PISTE_CLIENT_ID,
    client_secret: process.env.PISTE_CLIENT_SECRET,
    scope: "openid",
  });
  const res = await fetchRetry(TOKEN_URL, { method: "POST", body, headers: { Accept: "application/json" } }, { label: "PISTE token" });
  if (!res.ok) fail(`PISTE : obtention du jeton impossible (HTTP ${res.status}). Vérifie PISTE_CLIENT_ID / PISTE_CLIENT_SECRET.`);
  return (await res.json()).access_token;
}

async function api(tok, path, payload) {
  const res = await fetchRetry(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  }, { label: `Légifrance ${path}` });
  if (res.status === 403) fail("Légifrance : accès refusé (403). Ton application PISTE doit être abonnée à l'API Légifrance.");
  if (!res.ok) fail(`Légifrance ${path} : HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Titres des résultats de recherche, quelle que soit la forme de la réponse. Légifrance
// surligne les mots trouvés avec des balises (<mark>…</mark>) : on les retire.
function titresResultats(data) {
  const propre = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  return (data?.results || []).flatMap((r) => {
    const liste = r.titles?.length ? r.titles : [{ title: r.title || r.titre, cid: r.cid, id: r.id }];
    return liste.map((t) => ({ title: propre(t.title || t.titre), cid: t.cid || r.cid, id: t.id || r.id, date: r.date || r.dateSignature }));
  }).filter((t) => t.title);
}

const estArrete = (t) => /^arrete du/.test(norm(t.title)) && /fixant la liste des metiers et zones geographiques/.test(norm(t.title));
const estModificatif = (t) => /^arrete du/.test(norm(t.title)) && /modifiant.*liste des metiers et zones geographiques/.test(norm(t.title));

// Cherche l'arrêté le plus récent ; renvoie { cid, titre }. Plusieurs formulations sont essayées.
async function dernierArrete(tok) {
  const essais = [
    { fond: "JORF", typeRecherche: "EXACTE", valeur: TITRE_RECHERCHE },
    { fond: "JORF", typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP", valeur: "métiers zones géographiques difficultés recrutement" },
    { fond: "LODA_DATE", typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP", valeur: "métiers zones géographiques difficultés recrutement" },
  ];
  const vus = [];
  for (const e of essais) {
    const data = await api(tok, "/search", {
      fond: e.fond,
      recherche: {
        champs: [{ typeChamp: "TITLE", operateur: "ET", criteres: [{ typeRecherche: e.typeRecherche, valeur: e.valeur, operateur: "ET" }] }],
        filtres: [],
        pageNumber: 1,
        pageSize: 25,
        operateur: "ET",
        sort: "SIGNATURE_DATE_DESC",
        typePagination: "DEFAUT",
      },
    });
    const titres = titresResultats(data);
    vus.push(`${e.fond}/${e.typeRecherche} : ${data?.totalResultNumber ?? titres.length} résultat(s)${titres.length ? ` — ex. « ${titres[0].title.slice(0, 120)} »` : ""}`);
    const arretes = titres.filter(estArrete).sort((a, b) => dateTitre(b.title).localeCompare(dateTitre(a.title)));
    if (!arretes.length) continue;
    const [premier] = arretes;
    // Un arrêté « modifiant » ne contient que des changements : on ne peut pas reconstruire la liste seul.
    const modif = titres.filter(estModificatif).find((t) => dateTitre(t.title) > dateTitre(premier.title));
    if (modif) fail(`Légifrance : un arrêté modificatif plus récent existe (${modif.title}). Mise à jour manuelle nécessaire.`);
    return { cid: premier.cid || premier.id, titre: premier.title };
  }
  console.error("Diagnostic de la recherche Légifrance :\n  " + vus.join("\n  "));
  fail("Légifrance : aucun arrêté trouvé, la recherche ou le titre a peut-être changé.");
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function dateTitre(t) {
  const m = String(t).match(/du (\d{1,2})(?:er)? (\S+) (\d{4})/i);
  if (!m) return "";
  const mois = MOIS.indexOf(m[2].toLowerCase()) + 1;
  return `${m[3]}-${String(mois).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Concatène, dans l'ordre, tous les contenus textuels de la réponse /consult/jorf.
function texteDepuisJson(json) {
  const out = [];
  const walk = (v, key = "") => {
    if (typeof v === "string") {
      if (/^(title|titre|num|content|texte|texteHtml|contenu|nota|notice)$/i.test(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(json);
  return htmlToText(out.join("\n"));
}

// ---------- Programme ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const force = args.includes("--force");
  const actuel = readJson(OUT);

  let text, source;
  const pdf = opt("--pdf");
  if (pdf) {
    let buf;
    if (/^https?:/.test(pdf)) {
      const res = await fetchRetry(pdf, {}, { label: "PDF arrêté" });
      if (!res.ok) fail(`PDF : HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else buf = readFileSync(pdf);
    text = pdfToText(buf);
    const m = meta(text);
    source = { titre: m.titre, nor: m.nor, cid: null, url: opt("--url") || m.eli, date: dateTitre(m.titre || "") };
  } else {
    if (!process.env.PISTE_CLIENT_ID || !process.env.PISTE_CLIENT_SECRET) {
      console.log("ℹ France : PISTE_CLIENT_ID / PISTE_CLIENT_SECRET absents, liste française non vérifiée (données actuelles conservées).");
      return;
    }
    const tok = await token();
    const { cid, titre } = await dernierArrete(tok);
    const date = dateTitre(titre);
    if (!force && actuel?.source && (actuel.source.cid === cid || (actuel.source.date && actuel.source.date === date))) {
      console.log(`✔ France : ${titre} — inchangé`);
      return;
    }
    const json = await api(tok, "/consult/jorf", { textCid: cid });
    text = texteDepuisJson(json);
    const m = meta(text);
    source = { titre: (titre.match(/^(Arrêté du \d{1,2}(?:er)? \S+ \d{4})/i) || [])[1] || titre, nor: m.nor, cid, url: `https://www.legifrance.gouv.fr/jorf/id/${cid}`, date };
  }

  const familles = parseArrete(text);
  const regionsIds = new Set(familles.flatMap((f) => f.regions));
  if (regionsIds.size < 10 || familles.length < 30) {
    fail(`France : analyse suspecte (${familles.length} familles, ${regionsIds.size} régions). Données actuelles conservées.`);
  }
  const sansRome = familles.filter((f) => !f.rome.length).map((f) => f.code);
  if (sansRome.length) console.warn(`⚠ France : familles sans correspondance ROME : ${sansRome.join(", ")}`);

  familles.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  const out = {
    majLe: nowIso(),
    source: { ...source, titre: `${source.titre || "Arrêté"} fixant la liste des métiers en tension` },
    regions: REGIONS_FR.filter((r) => regionsIds.has(r.id)),
    familles,
  };
  const changed = writeJsonIfChanged(OUT, out);
  console.log(`✔ France : ${familles.length} familles dans ${regionsIds.size} régions${changed ? " — mis à jour" : " — inchangé"}`);
}

main().catch((e) => fail(e.message));
