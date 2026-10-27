# En tension — métiers en pénurie au Luxembourg & en France

Site public qui rassemble :

- la **liste ADEM des métiers très en pénurie** (Luxembourg) ;
- l'**arrêté fixant la liste des métiers en tension**, région par région (France) ;
- les **offres d'emploi en direct** pour chaque métier et région (API France Travail) ;
- des liens de recherche vers Indeed, LinkedIn, Moovijob, jobs.lu, France Travail, HelloWork ;
- un **suivi de candidatures** stocké dans le navigateur de chaque visiteur (rien n'est envoyé en ligne).

Tout est mis à jour **automatiquement chaque jour** par GitHub Actions, sans IA : des scripts
téléchargent les sources officielles, les analysent et publient les changements ; Vercel redéploie.

```
public/                 le site (HTML/CSS/JS, aucune dépendance)
  data/lu.json          liste Luxembourg (générée)
  data/fr.json          liste France (générée)
  data/offres/*.json    offres France Travail (générées)
scripts/
  update-lu.mjs         télécharge et analyse le PDF de l'ADEM
  update-fr.mjs         trouve et analyse le dernier arrêté via l'API Légifrance
  update-offres.mjs     interroge l'API Offres d'emploi v2 de France Travail
.github/workflows/update.yml   tâche planifiée quotidienne
```

## Mise en ligne (une seule fois)

### 1. Pousser le projet sur GitHub

Créer un dépôt vide sur github.com (par ex. `metiers-tension`), puis :

```sh
cd D:\Projets\metiers-tension-it
git init -b main
git add .
git commit -m "Premier commit"
git remote add origin https://github.com/<ton-compte>/metiers-tension.git
git push -u origin main
```

### 2. Brancher Vercel

Sur vercel.com : **Add New → Project → Import** le dépôt GitHub. Les réglages sont lus dans
`vercel.json` (pas de build, dossier `public`). Chaque commit — y compris ceux du robot —
redéploie le site automatiquement.

### 3. Clés API (gratuites)

**Légifrance (liste France)** — sur [piste.gouv.fr](https://piste.gouv.fr) :
1. Créer un compte, puis une application (environnement **Production**).
2. Accepter les CGU de l'API **Légifrance** et l'abonner à l'application.
3. Récupérer le *client_id* et le *client_secret* (OAuth).

**France Travail (offres en direct)** — sur [francetravail.io](https://francetravail.io) :
1. Créer un compte, puis une application.
2. Lui ajouter l'API **Offres d'emploi v2** (une validation peut être demandée).
3. Récupérer l'*identifiant client* et la *clé secrète*.

### 4. Ajouter les secrets dans GitHub

Dépôt → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom                   | Valeur                           |
|-----------------------|----------------------------------|
| `PISTE_CLIENT_ID`     | client_id PISTE                  |
| `PISTE_CLIENT_SECRET` | client_secret PISTE              |
| `FT_CLIENT_ID`        | identifiant client France Travail |
| `FT_CLIENT_SECRET`    | clé secrète France Travail       |

### 5. Lancer une première fois

Onglet **Actions → Mise à jour des données → Run workflow**. Ensuite, la tâche tourne seule
chaque jour à 5h UTC.

## Fonctionnement et sécurité des mises à jour

- Si une source change de format, le script s'arrête **sans écraser** les données existantes, et
  GitHub t'envoie un e-mail d'échec du workflow.
- Sans clés Légifrance, la liste française n'est simplement pas vérifiée (les données actuelles
  restent affichées). Sans clés France Travail, le site fonctionne sans les offres en direct.
- Si la France publie un arrêté **modificatif** (et non un nouvel arrêté complet), le script le
  signale ; il faut alors mettre à jour à la main :
  `node scripts/update-fr.mjs --pdf <lien-ou-fichier-pdf> --url <lien-legifrance>`.
- GitHub met en pause les tâches planifiées d'un dépôt sans activité pendant 60 jours. Avec les
  offres France Travail, le robot fait un commit par jour, ce qui évite ce cas.

## En local

Prérequis : Node 20+, et `pdftotext` (paquet *poppler-utils*) pour les scripts.

```sh
npm run dev                 # site sur http://localhost:3000
npm run update:lu           # met à jour la liste Luxembourg
npm run update:fr           # liste France (variables PISTE_CLIENT_ID / PISTE_CLIENT_SECRET)
npm run update:offres       # offres (variables FT_CLIENT_ID / FT_CLIENT_SECRET)
```

## Sources

- ADEM — Liste des métiers très en pénurie : https://adem.public.lu/dam-assets/fr/publications/adem/metiers-penurie.pdf
- Légifrance — Arrêté du 21 mai 2025 : https://www.legifrance.gouv.fr/eli/arrete/2025/5/21/TSSD2508346A/jo/texte
- France Travail — API Offres d'emploi v2 : https://francetravail.io

Site d'information indépendant, non affilié à l'ADEM, à France Travail ni à l'administration.
