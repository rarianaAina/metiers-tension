// Outils partagés par les scripts de mise à jour (Node 20+, aucune dépendance).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "public", "data");

// ---------- Secteurs ----------
// Un secteur commun pour les deux nomenclatures (ROME au Luxembourg, FAP en France).
export const SECTEURS = {
  informatique: "Informatique & télécoms",
  sante: "Santé & social",
  btp: "Bâtiment & travaux publics",
  industrie: "Industrie & ingénierie",
  maintenance: "Maintenance & réparation",
  hotellerie: "Hôtellerie & restauration",
  transport: "Transport & logistique",
  finance: "Finance, gestion & droit",
  commerce: "Commerce & vente",
  services: "Services aux personnes",
  agriculture: "Agriculture",
  education: "Éducation & formation",
  autres: "Autres métiers",
};

export function secteurFromRome(code) {
  if (/^M18/.test(code)) return "informatique";
  if (/^K1[12]/.test(code)) return "sante";
  if (/^K19/.test(code)) return "finance";
  if (/^K21/.test(code)) return "education";
  const map = { A: "agriculture", C: "finance", D: "commerce", F: "btp", G: "hotellerie", H: "industrie", I: "maintenance", J: "sante", K: "services", M: "finance", N: "transport" };
  return map[code[0]] || "autres";
}

export function secteurFromFap(code) {
  const map = {
    A: "agriculture", B: "btp", C: "industrie", D: "industrie", E: "industrie", F: "industrie",
    G: "maintenance", H: "industrie", J: "transport", K: "industrie", L: "finance", M: "informatique",
    N: "industrie", Q: "finance", R: "commerce", S: "hotellerie", T: "services", V: "sante", W: "education",
  };
  return map[code[0]] || "autres";
}

// ---------- Régions françaises (code = code INSEE, utilisé par France Travail) ----------
export const REGIONS_FR = [
  { id: "ara", code: "84", nom: "Auvergne-Rhône-Alpes" },
  { id: "bfc", code: "27", nom: "Bourgogne-Franche-Comté" },
  { id: "bre", code: "53", nom: "Bretagne" },
  { id: "cvl", code: "24", nom: "Centre-Val de Loire" },
  { id: "cor", code: "94", nom: "Corse" },
  { id: "ges", code: "44", nom: "Grand Est" },
  { id: "hdf", code: "32", nom: "Hauts-de-France" },
  { id: "idf", code: "11", nom: "Île-de-France" },
  { id: "nor", code: "28", nom: "Normandie" },
  { id: "naq", code: "75", nom: "Nouvelle-Aquitaine" },
  { id: "occ", code: "76", nom: "Occitanie" },
  { id: "pdl", code: "52", nom: "Pays de la Loire" },
  { id: "pac", code: "93", nom: "Provence-Alpes-Côte d'Azur" },
  { id: "gua", code: "01", nom: "Guadeloupe" },
  { id: "mar", code: "02", nom: "Martinique" },
  { id: "guy", code: "03", nom: "Guyane" },
  { id: "reu", code: "04", nom: "La Réunion" },
  { id: "may", code: "06", nom: "Mayotte" },
];

export function norm(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const regionByNorm = new Map(REGIONS_FR.map((r) => [norm(r.nom), r]));
export function regionFromHeading(line) {
  return regionByNorm.get(norm(line)) || null;
}

// ---------- Fichiers ----------
export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Écrit le fichier seulement si le contenu utile a changé (ignore le champ "majLe"),
// pour ne pas créer de commit ni de redéploiement inutile.
export function writeJsonIfChanged(path, data) {
  const strip = (d) => JSON.stringify({ ...d, majLe: undefined });
  const old = readJson(path);
  if (old && strip(old) === strip(data)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1) + "\n");
  return true;
}

export const nowIso = () => new Date().toISOString();

// ---------- Réseau ----------
export async function fetchRetry(url, options = {}, { tries = 4, label = url } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(1000 * 2 ** i);
    }
  }
  throw new Error(`${label} : ${lastErr?.message}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- PDF → texte (via pdftotext / poppler-utils) ----------
export function pdfToText(pdfBufferOrPath) {
  const dir = mkdtempSync(join(tmpdir(), "mt-"));
  try {
    let pdf = pdfBufferOrPath;
    if (typeof pdf !== "string") {
      pdf = join(dir, "in.pdf");
      writeFileSync(pdf, pdfBufferOrPath);
    }
    if (!existsSync(pdf)) throw new Error(`PDF introuvable : ${pdf}`);
    const out = join(dir, "out.txt");
    execFileSync("pdftotext", ["-enc", "UTF-8", "-layout", pdf, out]);
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- HTML → texte ----------
// Les cellules d'un tableau sont séparées par 3 espaces, chaque ligne de tableau devient
// une ligne de texte : le même analyseur fonctionne sur le PDF et sur l'API Légifrance.
export function htmlToText(html) {
  return String(html)
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/\s*t[dh]\s*>/gi, "   ")
    .replace(/<\s*(br|\/p|\/tr|\/div|\/h\d|\/li|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/[ \t]+\n/g, "\n");
}

export function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
