// Sélection quotidienne des offres pour le candidat, avec des règles fixes (aucune IA).
// Lit profil.json et les données collectées, note chaque offre, écarte celles déjà envoyées,
// puis écrit suivi/selection-du-jour.md (corps du ticket GitHub envoyé par e-mail).
// Usage : node scripts/selection-offres.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ROOT, norm, readJson } from "./lib.mjs";

const SUIVI = join(ROOT, "suivi");
const VUES = join(SUIVI, "offres-vues.json");
const SORTIE = join(SUIVI, "selection-du-jour.md");
const GARDER_VUES_JOURS = 120;

const profil = readJson(join(ROOT, "profil.json"));
if (!profil) throw new Error("profil.json introuvable ou invalide");
const aujourdhui = new Date().toISOString().slice(0, 10);
const vues = readJson(VUES, {});

// ---------- Notation ----------
// Mot entier : « java » ne doit pas correspondre à « javascript ».
const cache = new Map();
const contientMot = (texte, mot) => {
  if (!cache.has(mot)) cache.set(mot, new RegExp(`(^|[^a-z0-9])${norm(mot).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`));
  return cache.get(mot).test(texte);
};

function noter(o, { titreSeul = false } = {}) {
  const raisons = [];
  let score = 0;
  const texteTitre = norm(o.titre);
  const texte = titreSeul ? texteTitre : norm([o.titre, ...(o.tags || [])].join(" "));

  for (const [mot, poids] of Object.entries(profil.motsCles || {})) {
    if (contientMot(texte, mot)) { score += poids; raisons.push(mot); }
  }
  for (const t of o.techs || []) {
    const poids = profil.techs?.[t];
    if (poids && !raisons.some((r) => norm(r) === norm(t))) { score += poids; raisons.push(t); }
  }
  for (const [mot, poids] of Object.entries(profil.motsAEviter || {})) {
    if (contientMot(texteTitre, mot)) score += poids;
  }
  if (o.experience && profil.experienceMaxSouhaitee && o.experience > profil.experienceMaxSouhaitee) {
    score -= (o.experience - profil.experienceMaxSouhaitee) * (profil.penaliteParAnneeEnTrop || 1);
  }
  // Le bonus de type (freelance, contrat…) ne s'applique qu'aux offres déjà pertinentes :
  // une mission de rédaction ne doit pas remonter juste parce qu'elle est en freelance.
  const pertinent = score >= (profil.pertinenceMinimum ?? 3);
  if (pertinent) score += profil.bonusType?.[o.type] || 0;
  return { score: pertinent ? score : Math.min(score, 0), raisons: [...new Set(raisons)].slice(0, 6) };
}

// ---------- Télétravail ----------
const teletravail = readJson(join(DATA_DIR, "teletravail.json"), { offres: [], sources: {} });
const sources = teletravail.sources || {};
const zones = new Set(profil.zones || ["monde", "afrique"]);
const candidatsRemote = teletravail.offres
  .filter((o) => zones.has(o.zone) && !o.horsTeletravail && !vues[o.id] && !(o.expire && o.expire < aujourdhui))
  .map((o) => ({ ...o, ...noter(o) }))
  .filter((o) => o.score >= (profil.scoreMinimum ?? 6))
  .sort((a, b) => b.score - a.score || (b.date || "").localeCompare(a.date || ""))
  .slice(0, profil.maxOffresParJour ?? 15);
const freelance = candidatsRemote.filter((o) => o.type === "freelance" || o.type === "contrat");
const remote = candidatsRemote.filter((o) => !freelance.includes(o));

// ---------- France (offres France Travail des métiers en tension) ----------
let france = [];
const dirOffres = join(DATA_DIR, "offres");
if (profil.france?.actif && existsSync(dirOffres)) {
  const fr = readJson(join(DATA_DIR, "fr.json"), { regions: [], familles: [] });
  const nomRegion = Object.fromEntries((fr.regions || []).map((r) => [r.id, r.nom]));
  const familles = new Set(profil.france.familles || []);
  const regions = profil.france.regions === "toutes" ? null : new Set(profil.france.regions || []);
  const parId = new Map();
  for (const fichier of readdirSync(dirOffres).filter((f) => f.endsWith(".json") && f !== "index.json")) {
    const data = readJson(join(dirOffres, fichier));
    if (!data?.familles || (regions && !regions.has(data.region))) continue;
    for (const [code, f] of Object.entries(data.familles)) {
      if (!familles.has(code)) continue;
      for (const o of f.offres || []) {
        const id = `ft-${o.id}`;
        if (vues[id] || parId.has(id)) continue;
        const n = noter({ titre: o.titre }, { titreSeul: true });
        parId.set(id, { ...o, id, region: nomRegion[data.region] || data.region, score: n.score + 4, raisons: n.raisons });
      }
    }
  }
  france = [...parId.values()]
    .filter((o) => o.score >= 4)
    .sort((a, b) => b.score - a.score || (b.date || "").localeCompare(a.date || ""))
    .slice(0, profil.france.maxOffres ?? 10);
}

// ---------- Modèle de message (écrit par le candidat) ----------
let modele = null;
const cheminModele = join(ROOT, "modele-candidature.md");
if (existsSync(cheminModele)) {
  const brut = readFileSync(cheminModele, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (brut && !/À ÉCRIRE/.test(brut)) modele = brut;
}
const remplir = (o, source) => modele
  .replaceAll("{{poste}}", o.titre || "")
  .replaceAll("{{entreprise}}", o.entreprise || "votre entreprise")
  .replaceAll("{{lien}}", o.url || "")
  .replaceAll("{{source}}", source || "");

// ---------- Rendu Markdown ----------
const TYPES = { freelance: "Freelance", contrat: "Contrat / mission", "temps-plein": "Temps plein", "temps-partiel": "Temps partiel", stage: "Stage" };
const ZONES = { monde: "Monde entier", afrique: "Afrique / EMEA" };
const md = (s) => String(s ?? "").replace(/([\\`*_[\]<>|])/g, "\\$1");
const dateFr = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "");

function blocOffre(o, i, sourceNom) {
  const meta = [
    `score **${o.score}**`,
    TYPES[o.type] || o.contrat || null,
    ZONES[o.zone] || o.region || o.lieu || null,
    o.salaire || null,
    sourceNom ? `via ${sourceNom}` : null,
    o.date ? `publiée le ${dateFr(o.date)}` : null,
  ].filter(Boolean).join(" · ");
  let s = `### ${i}. ${md(o.titre)}${o.entreprise ? ` — ${md(o.entreprise)}` : ""}\n`;
  s += `- ${meta}\n`;
  if (o.raisons?.length) s += `- **Correspond à ton profil :** ${o.raisons.map(md).join(", ")}\n`;
  if (o.experience) s += `- **Expérience demandée :** ${o.experience} ans et plus\n`;
  s += `- **Postuler :** ${o.url}\n`;
  if (modele) s += `\n<details><summary>Ton message pour cette offre</summary>\n\n${remplir(o, sourceNom)}\n\n</details>\n`;
  return s + "\n";
}

const total = freelance.length + remote.length + france.length;
let corps = `@${profil.github} — **${total} nouvelle${total > 1 ? "s" : ""} offre${total > 1 ? "s" : ""}** sélectionnée${total > 1 ? "s" : ""} pour toi aujourd'hui.\n\n`;
let n = 0;
if (freelance.length) {
  corps += `## 🧑‍💻 Freelance et missions (${freelance.length})\n\n`;
  freelance.forEach((o) => (corps += blocOffre(o, ++n, sources[o.source]?.nom)));
}
if (remote.length) {
  corps += `## 🌍 Télétravail, accessible depuis le monde entier (${remote.length})\n\n`;
  remote.forEach((o) => (corps += blocOffre(o, ++n, sources[o.source]?.nom)));
}
if (france.length) {
  corps += `## 🇫🇷 France, métiers en tension, postes sur place (${france.length})\n\n`;
  corps += `_Postes en France : il faut une autorisation de travail. Les métiers en tension facilitent la démarche pour l'employeur._\n\n`;
  france.forEach((o) => (corps += blocOffre(o, ++n, "France Travail")));
}
const lu = profil.luxembourg?.recherches || [];
if (lu.length) {
  corps += `## 🇱🇺 Luxembourg, recherches à relancer\n\n`;
  corps += lu.map((q) => `- **${md(q)}** : [Indeed](https://lu.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Luxembourg) · [Moovijob](https://www.moovijob.com/recherche?q=${encodeURIComponent(q)}) · [LinkedIn](https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=Luxembourg)`).join("\n") + "\n\n";
}
if (!modele) corps += `> 💡 Écris ton message de candidature dans \`modele-candidature.md\` : il sera recopié automatiquement sous chaque offre.\n\n`;
corps += `---\n_Liste générée automatiquement à partir des règles de \`profil.json\`, sans IA. Les offres déjà envoyées ne reviennent pas. Vérifie toujours l'offre avant de postuler._\n`;

// ---------- Écriture ----------
mkdirSync(SUIVI, { recursive: true });
const limite = new Date(Date.now() - GARDER_VUES_JOURS * 864e5).toISOString().slice(0, 10);
const nouvellesVues = Object.fromEntries(Object.entries(vues).filter(([, d]) => d >= limite));
[...freelance, ...remote, ...france].forEach((o) => (nouvellesVues[o.id] = aujourdhui));
writeFileSync(VUES, JSON.stringify(nouvellesVues, null, 1) + "\n");
writeFileSync(SORTIE, corps);
writeFileSync(join(SUIVI, "selection-du-jour.count"), String(total));
console.log(`✔ Sélection : ${total} offres (freelance ${freelance.length}, télétravail ${remote.length}, France ${france.length})`);
