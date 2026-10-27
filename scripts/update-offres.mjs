// France : nombre d'offres et dernières annonces pour chaque métier en tension et chaque région,
// via l'API « Offres d'emploi v2 » de France Travail (FT_CLIENT_ID / FT_CLIENT_SECRET).
// Usage : node scripts/update-offres.mjs
import { join } from "node:path";
import { DATA_DIR, fail, fetchRetry, nowIso, readJson, sleep, writeJsonIfChanged } from "./lib.mjs";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const PAR_METIER = 6; // annonces conservées par métier et par région
const PAUSE_MS = 350; // ~3 requêtes / seconde

let tok = null;
let tokExpire = 0;

async function token() {
  if (tok && Date.now() < tokExpire) return tok;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.FT_CLIENT_ID,
    client_secret: process.env.FT_CLIENT_SECRET,
    scope: "api_offresdemploiv2 o2dsoffre",
  });
  const res = await fetchRetry(TOKEN_URL, { method: "POST", body }, { label: "France Travail token" });
  if (!res.ok) fail(`France Travail : jeton refusé (HTTP ${res.status}) ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  tok = j.access_token;
  tokExpire = Date.now() + ((j.expires_in || 1400) - 60) * 1000;
  return tok;
}

function annonce(o) {
  return {
    id: o.id,
    titre: o.intitule,
    entreprise: o.entreprise?.nom || null,
    lieu: o.lieuTravail?.libelle || null,
    contrat: o.typeContratLibelle || o.typeContrat || null,
    date: (o.dateActualisation || o.dateCreation || "").slice(0, 10) || null,
    url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
  };
}

async function chercher(romes, regionCode) {
  const params = new URLSearchParams({ codeROME: romes.join(","), region: regionCode, range: `0-${PAR_METIER - 1}`, sort: "1" });
  const res = await fetchRetry(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json" },
  }, { label: `offres ${romes[0]} / ${regionCode}` });
  if (res.status === 204) return { total: 0, offres: [] };
  if (res.status === 401) {
    tok = null;
    return chercher(romes, regionCode);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const range = res.headers.get("content-range") || ""; // « offres 0-5/1234 »
  const total = Number(range.split("/")[1]) || (j.resultats || []).length;
  return { total, offres: (j.resultats || []).map(annonce) };
}

async function main() {
  if (!process.env.FT_CLIENT_ID || !process.env.FT_CLIENT_SECRET) {
    console.log("ℹ Offres : FT_CLIENT_ID / FT_CLIENT_SECRET absents, offres en direct non mises à jour.");
    return;
  }
  const fr = readJson(join(DATA_DIR, "fr.json"));
  if (!fr) fail("Offres : public/data/fr.json introuvable, lance d'abord update-fr.");

  const majLe = nowIso();
  const index = { majLe, totaux: {} };
  let ok = 0;
  let erreurs = 0;

  for (const region of fr.regions) {
    const familles = {};
    index.totaux[region.id] = {};
    for (const f of fr.familles.filter((x) => x.regions.includes(region.id))) {
      try {
        const r = await chercher(f.rome.map((x) => x.code), region.code);
        familles[f.code] = r;
        index.totaux[region.id][f.code] = r.total;
        ok++;
      } catch (e) {
        erreurs++;
        console.warn(`⚠ ${f.code} / ${region.nom} : ${e.message}`);
      }
      await sleep(PAUSE_MS);
    }
    writeJsonIfChanged(join(DATA_DIR, "offres", `${region.id}.json`), { majLe, region: region.id, familles });
    console.log(`  ${region.nom} : ${Object.keys(familles).length} métiers`);
  }

  if (erreurs > (ok + erreurs) * 0.3) fail(`Offres : trop d'erreurs (${erreurs}/${ok + erreurs}), index non mis à jour.`);
  writeJsonIfChanged(join(DATA_DIR, "offres", "index.json"), index);
  console.log(`✔ Offres : ${ok} recherches réussies, ${erreurs} erreurs`);
}

main().catch((e) => fail(e.message));
