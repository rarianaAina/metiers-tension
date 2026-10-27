// Luxembourg : télécharge la liste ADEM des métiers très en pénurie et l'enregistre en JSON.
// Usage : node scripts/update-lu.mjs [chemin-ou-url-du-pdf]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, fail, fetchRetry, nowIso, pdfToText, secteurFromRome, writeJsonIfChanged } from "./lib.mjs";

const ADEM_URL = "https://adem.public.lu/dam-assets/fr/publications/adem/metiers-penurie.pdf";

// « Développeur / Développeuse web » -> « Développeur web »
// « Analyste fonctionnel / fonctionnelle informatique » -> « Analyste fonctionnel informatique »
export function intituleCourt(nom) {
  const parts = nom.split(/\s+\/\s+/);
  if (parts.length !== 2) return nom;
  const masc = parts[0].split(" ");
  const fem = parts[1].split(" ");
  // La partie féminine commence au mot masculin qui a la même racine (ex. « fonctionnel » / « fonctionnelle »).
  const racine = (w) => w.toLowerCase().slice(0, 4);
  let j = masc.findIndex((w) => racine(w) === racine(fem[0]));
  if (j < 0) j = 0;
  const suite = fem.slice(masc.length - j).join(" ");
  return suite ? `${parts[0]} ${suite}` : parts[0];
}

function splitAppellations(s) {
  return s
    .split(/,\s+(?=[A-ZÀ-ÝÉ])/)
    .map((x) => x.replace(/\s+/g, " ").replace(/[,.\s]+$/, "").trim())
    .filter(Boolean);
}

export function parseAdem(text) {
  // Retire les notes de bas de page (lignes « 1 Postes déclarés… » jusqu'à la fin de la page).
  const pages = text.split("\f").map((page) => {
    const lines = page.split("\n");
    const i = lines.findIndex((l) => /^\s{0,4}\d\s+[A-ZÀ-Ý]/.test(l));
    return (i >= 0 ? lines.slice(0, i) : lines).join("\n");
  });
  const flat = pages
    .join("\n")
    .replace(/(\p{L})-[ \t\r]*\n\s*/gu, "$1-") // mot coupé en fin de ligne : « Aide-\nsoignante »
    .replace(/\s+/g, " ");

  const annee = (flat.match(/très en pénurie (\d{4})/i) || [])[1] || null;
  const reference = (flat.match(/\(?(Mémorial B N° ?\d+ du [^)]+?)\)/) || [])[1] || null;
  const rectif = (flat.match(/rectificatif \((Mémorial B N° ?\d+ du [^)]+?)\)/) || [])[1] || null;

  const re = /Métier\s*:\s*([A-N]\d{4})\s*-\s*(.+?)\s+Appellations sous-jacentes\s*:\s*(.*?)(?=Métier\s*:|Définition des métiers|Seule la version|$)/g;
  const metiers = [];
  let m;
  while ((m = re.exec(flat))) {
    const [, code, titre, reste] = m;
    const [inclus, exclusRaw = ""] = reste.split(/Appellations exclues\s*:/);
    const exclues = splitAppellations(exclusRaw).map((x) => x.replace(/(\D)\d+$/, "$1"));
    metiers.push({
      code,
      titre: titre.trim(),
      secteur: secteurFromRome(code),
      appellations: splitAppellations(inclus).map((nom) => ({ nom, court: intituleCourt(nom) })),
      exclues,
    });
  }
  return { annee, reference, rectif, metiers };
}

async function main() {
  const arg = process.argv[2];
  let buf;
  if (arg && !/^https?:/.test(arg)) buf = readFileSync(arg);
  else {
    const res = await fetchRetry(arg || ADEM_URL, { headers: { "User-Agent": "metiers-tension-updater" } }, { label: "ADEM" });
    if (!res.ok) fail(`ADEM : HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const { annee, reference, rectif, metiers } = parseAdem(pdfToText(buf));

  if (metiers.length < 5) fail(`ADEM : seulement ${metiers.length} métiers trouvés, le format du PDF a peut-être changé.`);
  if (metiers.some((x) => !x.appellations.length)) fail("ADEM : un métier sans appellation, analyse suspecte.");

  const out = {
    majLe: nowIso(),
    source: {
      titre: `ADEM – Liste des métiers très en pénurie${annee ? ` ${annee}` : ""}`,
      url: ADEM_URL,
      annee,
      reference: [reference, rectif && `rectifié par le ${rectif}`].filter(Boolean).join(", "),
    },
    metiers,
  };
  const changed = writeJsonIfChanged(join(DATA_DIR, "lu.json"), out);
  console.log(`✔ Luxembourg : ${metiers.length} métiers (${annee ?? "année inconnue"})${changed ? " — mis à jour" : " — inchangé"}`);
}

main().catch((e) => fail(e.message));
