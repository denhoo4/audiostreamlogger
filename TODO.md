# audiostreamlogger — TODO & status

Levend document om de modernisering/opschoning van het project bij te houden.
Laatst bijgewerkt: 2026-10-23 (API-split gemerged naar main via fast-forward)

---

## Branches

### `security-update` — GEMERGED NAAR `main`
Status: afgerond, APPROVED, gerebased op `main` en fast-forward gemerged. Worktree + branch opgeruimd.
Commits op main: a13c97e, a141df3, ce89639.

Wat erin zit:
- Dependencies gebumpt: express ^5.1.0, node-cron ^4.6.0, fluent-ffmpeg ^2.1.3, cors ^2.8.5.
- Nep-/builtin-npm-packages verwijderd (fs, path, child-process, fs.promises, index.js)
  en ongebruikte auth-libs (basic-auth, express-basic-auth).
- Dockerfile.peakfilegenerator herschreven naar node:26-bookworm + audiowaveform 1.10.2
  via de officiële BBC .deb (dode ubuntu:20.04 + PPA verwijderd). Alle services op
  node:26-bookworm.
- Root `.dockerignore` toegevoegd; readme.txt bijgewerkt (docker-compose -> docker compose).
- Security-fixes frontend:
  - /selection-export: path traversal dichtgetimmerd (whitelist + path.resolve-containment).
  - Temp-file-leak opgelost (os.tmpdir(), opruimen in alle paden).
  - CORS standaard uit (alleen aan bij CORS_ORIGIN).
  - nginx autoindex off.
  - Poort configureerbaar via APP_PORT (compose ${PORT}:80 blijft werken).

### `frontend-react` — GEMERGED NAAR `main` (finalize klaar)
Status: nieuwe React + Vite + TS frontend geïmplementeerd in `frontend-react/`,
gecommit (10ffce3, + 9d57d33 task-artifacts). Gerebased op `main` (was al op de
huidige `main`-tip, dus no-op/geen conflicten) en `main` fast-forward gezet naar
`frontend-react` (`main` == `frontend-react` == 9d57d33). Legacy `frontend/` ongemoeid,
backend ongewijzigd. NB: `security-update` is nog niet gemerged, dus de verwachte
compose/Dockerfile.frontend-conflicten deden zich hier (nog) niet voor.
Semantische review-gate op APPROVED (zie .agents/tasks/review.md / review.json);
geen blokkerende findings.
- Wavesurfer v7 (7.12.12) + Regions behouden; styling uit oude bundle gereconstrueerd:
  waveColor "violet", progressColor "purple", normalize true, overige visuals v7-defaults,
  regions via knoppen op playhead.
- flatpickr en lodash eruit (datetime wordt native input).
- Functionaliteit 1-op-1, Nederlandse labels, alle control-id's.
- Spreekt bestaande API's aan: /api/settings(2), /audio/..mp3 + .json peaks, POST /util/selection-export.
- Geverifieerd in node:20 container: npm install + build (dist/ geproduceerd) + test (1 passed) allemaal exit 0.
- Non-blocking findings uit review (later oppakken): download-selectie faalt nu stil
  (alleen console.error i.p.v. zichtbare fout zoals legacy); optionele extra's uit oude
  bundle (rechtsklik=pause, dubbelklik=play, muiswiel=zoom) nog niet geïmplementeerd;
  smoke-test dekt alleen render, niet de selectie-math/export-flow.
- Finalize gedaan: `frontend-react` zit nu op `main`. Dev draaien: `cd frontend-react
  && npm install && npm run dev`. Inhaken in Docker/Express-serving is een vervolgstap.

---

## Afgesproken vervolgstappen

### 1. Merge-volgorde — AFGEROND
- [x] `security-update` -> `main` (gerebased, ff-merge, artefact-conflicten opgelost).
- [x] `frontend-react` -> `main` (ff-merge).
- [x] `docker compose build` op gemergde `main` bouwt alle vier de images schoon.
- [x] Worktrees + tijdelijke branches opgeruimd; `.agents/` uit tracking gehaald en gitignored.
- [ ] Nog NIET gepusht naar `origin/main` (wacht op akkoord user; origin staat op "Rollback").

### 2. API-laag lostrekken van de frontend  (netheid; API is alleen voor de frontend)
Gekozen eindbeeld (same-origin, geen CORS nodig). STATUS: GEÏMPLEMENTEERD + GEVERIFIEERD
+ GEMERGED NAAR `main` via fast-forward (commit 687eafd; `main` == `api-split`).
Verificatierapport: `.agents/tasks/api-split-verification.md`.
- [x] Aparte `api`-service: puur Node + Express, eigen `api/package.json` (express + fluent-ffmpeg,
      geen cors), `Dockerfile.api` op node:26-bookworm + ffmpeg.
      Route-bestanden verhuisd naar `api/routes/` als enige bron (legacy `frontend/routes/` weg,
      geen dubbele kopie). Draait intern op 3000, niet publiek. Mount audio (rw) + settings.json (ro).
- [x] `frontend`-service: multi-stage build — stage 1 (node:26-bookworm) `npm run build` van
      `frontend-react/`, stage 2 (nginx:1.27-bookworm) serveert `dist/`. Klein productie-image,
      geen npm/Node in de runtime. Legacy single-container frontend (index.js + web/) verwijderd.
- [x] nginx proxyt `/api` en `/util` door naar `http://api:3000` → browser ziet alles op één origin,
      geen CORS. `/audio` direct door nginx geserveerd (autoindex off). `/logger`-alias vervallen
      (bevestigd ongebruikt in de React-app).
- [x] docker-compose.yml herschreven: nieuwe `api`-service, herbouwde `frontend`-service,
      beide op `web-network`. recorder/cleaner/peakfilegenerator ongewijzigd.
- [x] Meegenomen: de HIGH `/settings2` `.map`-bug als one-liner gefixt (`JSON.parse(...).streams`)
      omdat het bestand toch verhuisde. Zie ook de HIGH-lijst hieronder (nu afgevinkt).

### 3. "Ik wil gewoon bij zijn" — dependency-automatisering
- [ ] Renovate of Dependabot opzetten: automatische PR's voor zowel base-images
      (node:XX / nginx:XX) als npm-packages. Dit is de enige manier die zowel de
      image-laag als de package-laag bijhoudt (image-nummer bumpen dekt alleen OS+Node,
      niet de npm-deps).

### 4. Stale lockfiles opruimen (non-blocking nit uit de security-review)
- [ ] package-lock.json's pinnen nog oude versies. Nu onschadelijk omdat de Dockerfiles
      `npm install` gebruiken, maar bijt zodra je naar `npm ci` gaat. Regenereren na de
      dependency-bumps. Overweeg daarna `npm ci` in de Dockerfiles voor reproduceerbare builds.

---

### 5. Settings-scherm met database  (BESLOTEN — user wil een settings-scherm met een DB)
Probleem: `settings.json` mengt nu twee soorten config die een verschillend ritme hebben:
- Operationeel/infra: cron-minuten (recorder_minute, cleaner_minute, peakfile_minute) + log_retention.
  Zet-en-vergeet -> hoort als env vars in docker-compose.yml.
- Content/domein: de streamlijst (naam, folder, url, land). Wil je makkelijk kunnen beheren.

Besloten aanpak (LATERE fase, ná de API-splitsing):
- [ ] Streams -> echte database (SQLite volstaat voor een handvol streams; Postgres als het groeit —
      keuze afhankelijk van verwachte schaal, nog te bepalen bij de bouw).
- [ ] CRUD-endpoints op de API voor streams (met validatie).
- [ ] Settings-scherm in de React-frontend om streams te beheren.
- [ ] Recorder (en peakfilegenerator/cleaner waar relevant) leest streams per cron-run uit de DB
      i.p.v. het bestand, zodat wijzigingen werken zonder container-herstart.
- [ ] Cron/retentie-config: standaard naar env vars in compose (zet-en-vergeet).
Beslissingen vooraf nodig:
- [ ] AUTH. Een schrijvend settings-scherm mag niet publiek-schrijfbaar zijn. Auth is nu
      bewust uitgesteld; die vraag komt hier onvermijdelijk terug. Beslissen vóór bouw.
- [ ] Open vraag aan user: moeten cron/retentie óók via het scherm aanpasbaar zijn
      (maakt het complexer: services moeten dan herladen), of blijft dat env-only?
- [ ] DB-keuze SQLite vs Postgres (hangt af van verwachte aantal streams / gebruikers).
Volgorde: doen ná de API-splitsing (stap 2), want het scherm hangt af van de API-vorm.

---

## Technical debt / lelijke dingen
Volledige read-only audit afgerond. Volledig rapport met bestands-/regelcitaten:
`.agents/tasks/techdebt-audit.md`. Onderstaande lijst is de samenvatting, gesorteerd op prioriteit.
Deze punten overlappen NIET met de security-update / React / API-split / DB-plannen hierboven —
het is aparte resilience/correctheid-debt die ook na het mergen van die branches blijft bestaan.

Eerst oppakken (HIGH):
- [x] `routes/api.js` `/settings2` roept `.map()` aan op het settings-*object* i.p.v.
      `.streams` → endpoint gooit altijd een TypeError (500). Fix: `JSON.parse(...).streams`.
      GEFIXT in de api-split (bestand verhuisd naar `api/routes/api.js`).
- [ ] `peakfilegenerator.js`: `filename.match(/…/)[0]` crasht op elke `.mp3` zonder datumpatroon
      (bv. `temp-*.mp3`) en breekt de hele run af. Fix: match guarden.
- [ ] Geen `restart:`-policy en geen healthchecks in `docker-compose.yml`; gecombineerd met
      `process.exit(1)` als enige foutafhandeling is een crash permanent. Fix: `restart:
      unless-stopped` + healthcheck per service, en niet meer blind exiten bij transiente fouten.
- [ ] `cleaner/deletefiles.js`: `thresholdTime` wordt één keer bij boot berekend → retentievenster
      groeit met elk draaiuur. Plus `log_retention` is gevalideerd op `< 60`, dus >59u retentie
      kan niet (readme-voorbeeld gebruikt 168). Fix: threshold in de cron-callback berekenen en
      `log_retention` een eigen zinnige bovengrens geven.
- [ ] Geen tests in de originele services (recorder/cleaner/peakfilegenerator/API). Fix: minimale
      `node:test`-suite op de pure logica (minuut-validatie, datumregex, `/settings2`-transform,
      retentie-threshold).

Daarna (MEDIUM):
- [ ] Gedupliceerde settings-lees + minuut-validatie in alle drie workers, met afwijkende grenzen
      en meldingen. Fix: één gedeelde `loadSettings()` + `validateMinute()`-module.
- [ ] `recorder.js` schrijft naar `audio/${folder}` uit settings zonder containment-check; wordt
      user-input zodra het settings-scherm/DB er is. Fix: folder-allowlist + path.resolve-check nu
      alvast toevoegen.
- [ ] Blokkerende sync-I/O + `execSync` met shell-geïnterpoleerde paden (peakfilegenerator).
      Fix: `fs.promises` + `execFile`/`spawn` (lost meteen de quoting/injectie op).
- [ ] Geen graceful shutdown (SIGTERM/SIGINT) in de workers of de Express-server; recorder kan
      mid-ffmpeg een half bestand achterlaten.
- [ ] `api.js` `/settings2`: impliciete global `transformedJson` (geen const/let) = gedeelde
      mutable state tussen requests; plus lekkend `test`-veld in de response.
- [ ] `settings.json` is gitignored maar wel gemount in elke container; verse clone heeft geen
      bestand en elke service exit. Fix: `settings.example.json` committen + copystap documenteren.

Lager (LOW):
- [ ] `recorder.js`: ffmpeg-fouten worden stil weggeslikt (alleen console.error), geen retry/gat-log.
- [x] `index.js` mount dezelfde util-router op zowel `/util` als `/logger` (dubbele route).
      OPGELOST in de api-split: `/logger`-alias vervallen in `api/index.js`.
- [ ] `express.json()` zonder `limit` op de util-router (onbegrensde body).
- [ ] Logging: alleen `console.log`, geen levels, inconsistente timestamps/foutmeldingen.
- [ ] Vier bijna-identieke Dockerfiles + worker-`package.json`s (duplicatie, drift); `npm install`
      i.p.v. `npm ci`.
- [ ] `readme.txt` → `README.md`; poort- (9702 vs 9703) en retentie-voorbeeld (168 vs <60)
      kloppen niet met de echte config.
- [ ] Placeholder-metadata (`author: "Your Name"`); frontend-`package.json` mist name/version/scripts.
- [ ] `.DS_Store` in de repo-root; toevoegen aan `.gitignore`.
