# audiostreamlogger — TODO & status

Levend document om de modernisering/opschoning van het project bij te houden.
Laatst bijgewerkt: 2026-10-23 (`recorder-catchup` fast-forward gemerged naar `main` == c36d630, inhaal-opname afgerond; lokaal, nog NIET gepusht)

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

### `techdebt-high` — GEMERGED NAAR `main` (lokaal, nog NIET gepusht)
Status: afgerond, APPROVED, fast-forward gemerged in `main` (`main` == `techdebt-high` == 5625599,
was al op de `main`-tip fccedef gebaseerd dus rebase was een no-op). NIET gepusht — origin staat op
"Rollback", de user pusht handmatig. Worktree `.worktrees/techdebt-high` blijft staan tot de
orchestrator opruimt. Commits op `main` (op fccedef): 7d967db, 446b46f, ff28ff3, f69df16, 5625599.
Alle vijf HIGH-items zijn hiermee afgevinkt (zie de HIGH-lijst onderaan).

Worktree op `.worktrees/techdebt-high`, branch `techdebt-high` op basis van `main`
(fccedef). Hier zijn de HIGH technical-debt-items opgepakt (zie de HIGH-lijst onderaan).
Plan + FEAT-decompositie zijn geschreven (`.agents/tasks/techdebt-plan.md`,
`.agents/tasks/task.json` + `context.json` + `features/FEAT-001..004.json`). De vijf items zijn
opgeknipt in vier features: FEAT-001 (api `/settings2` bevestigen + transform-helper),
FEAT-002 (peakfile-regex guard + cleaner-retentie), FEAT-003 (crash-resilience: try/catch in
cron, `restart: unless-stopped` + healthchecks, `/healthz`), FEAT-004 (minimale `node:test`-suite).
Keuze: per-service helpers i.p.v. één gedeelde module, om de Docker-COPY's simpel te houden
(de `validateMinute`-duplicatie blijft een uitgestelde MEDIUM-follow-up). De implementatie-workflow
(coder-per-FEAT + convergentie-loop met reviewer) loopt nu; een latere stap rebaset de worktree en
merget naar `main`, de orchestrator ruimt daarna op.

Voortgang op de branch (nog NIET op `main`):
- FEAT-002 AFGEROND (worker-correctheid, HIGH-items 2 en 4). Nieuwe per-service helpers
  `src/peakfilegenerator/filename-utils.js` (`extractFileDateTime` → match of `null`, geen
  `[0]` op null) en `src/cleaner/settings-utils.js` (`validateMinute` 0..59 +
  `validateRetentionHours` 1..8760). `peakfilegenerator.js` slaat nu `.mp3`-bestanden zonder
  datumpatroon over (log + `return`) i.p.v. de hele run te laten crashen. `deletefiles.js`
  accepteert `log_retention` tot 8760u (168 werkt nu) en berekent `thresholdTime` elke cron-run
  opnieuw (via parameter). `cleaner_minute`-check bewust op de oude 1..59-grens gehouden
  (gedrag niet verruimd). Beide nieuwe modules hebben een eigen `COPY`-regel gekregen in
  `Dockerfile.peakfilegenerator`/`Dockerfile.cleaner`. Geverifieerd: `node --check` op alle vier
  bestanden + `docker compose -p asl-techdebt build peakfilegenerator cleaner` (beide images, exit 0).
- FEAT-003 AFGEROND (crash-resilience, HIGH-item 3). Elke cron-callback in `recorder.js`,
  `deletefiles.js` en `peakfilegenerator.js` zit nu in een try/catch die een greppable
  `'<service>:'`-regel logt en `return`t i.p.v. te crashen; de boot-config-exits (settings lezen +
  minuut-/retentie-validatie) zijn bewust intact gelaten. Alle drie workers schrijven een
  `/tmp/heartbeat` (ISO-timestamp) via een logging-only helper, één keer na boot-validatie en aan
  het begin van elke cron-tick. `src/api/index.js` heeft een `GET /healthz` → 200 `{status:'ok'}`
  (geen disk-I/O). `docker-compose.yml`: `restart: unless-stopped` op alle vijf services +
  healthchecks (workers = heartbeat-versheid `age<4500s`, api = `node http /healthz`, frontend =
  `curl` op nginx-root). `curl` moest worden toegevoegd aan stage 2 van `Dockerfile.frontend`
  (nginx:1.27-bookworm heeft het niet). Geverifieerd: `node --check` op de vier bestanden,
  `PORT=9797 docker compose -p asl-techdebt build` (alle vijf images), en een smoke-test
  (`-p asl-techdebt`, `PORT=9797`) waarin alle vijf containers `healthy` werden en
  `curl /api/settings` → 200; daarna `down -v`. NB: `/api/settings2` gaf 500 door een lege
  gemounte `audio/` (geen stream-subfolders → ENOENT in `routes/api.js`), een
  omgevings-/data-conditie los van FEAT-003 (opgelost tijdens de integratieverificatie, zie hieronder).
- CROSS-FEAT INTEGRATIEVERIFICATIE AFGEROND (integration-fixer op `techdebt-high`). Alle drie de
  `node:test`-suites (cleaner 4/4, peakfilegenerator 2/2, api 3/3) + `node --check` op de negen
  runtime/helper-bestanden draaiden exit 0 in node:26-bookworm. `PORT=9797 docker compose
  -p asl-techdebt build` bouwde alle vijf images; smoke-up had alle vijf containers `healthy` en
  `/api/settings` → 200. Eén seam gefixt: de in FEAT-003 gesignaleerde `/settings2`-500 op een
  verse stack is opgelost — `folderContent()` in `src/api/routes/api.js` behandelt een nog-niet-
  bestaande stream-subfolder (ENOENT) nu als lege logs (`return {}`) i.p.v. de hele `Promise.all`
  te laten rejecten; andere fouten blijven doorpropageren. `/api/settings2` → 200 (geneste tree,
  leeg per station zolang er geen opnames zijn). Daarna `down -v`; de 9703/audiostreamlogger-stack
  bleef onaangeroerd. Commit op `techdebt-high` (nog NIET gemerged/gepusht).
- FEAT-004 AFGEROND (minimale backend-testsuite, HIGH-item 5). Drie `node:test`+`node:assert`-
  suites toegevoegd op de pure helpers uit FEAT-001/FEAT-002, zonder nieuwe dependency:
  `src/cleaner/test/settings-utils.test.js` (`validateMinute` 0/59 ok, verwerpt -1/60/1.5/'x';
  `validateRetentionHours` 1/168/8760 ok, verwerpt 0/9000/1.5/'x'),
  `src/peakfilegenerator/test/filename-utils.test.js` (`extractFileDateTime` → stamp of `null`),
  `src/api/test/settings-transform.test.js` (`buildBrowseTree` → geneste tree, `_`→spatie in namen,
  `{}` bij lege array). `"test": "node --test"` toegevoegd aan de drie `package.json`'s (api kreeg
  een nieuw `scripts`-blok). `test/`-mappen bewust NIET in enige Dockerfile-COPY opgenomen (images
  kopiëren alleen runtime-`.js`). Geverifieerd via `node:26-bookworm`-containers (geen host-Node):
  cleaner 4/4, api 3/3, peakfilegenerator 2/2 — alle exit 0.

---

## Afgesproken vervolgstappen

### 1. Merge-volgorde — AFGEROND
- [x] `security-update` -> `main` (gerebased, ff-merge, artefact-conflicten opgelost).
- [x] `frontend-react` -> `main` (ff-merge).
- [x] `techdebt-high` -> `main` (ff-merge; `main` == 5625599). Commits: 7d967db, 446b46f,
      ff28ff3, f69df16, 5625599.
- [x] `docker compose build` op gemergde `main` bouwt alle vier de images schoon.
- [x] Worktrees + tijdelijke branches opgeruimd; `.agents/` uit tracking gehaald en gitignored.
      (Worktree `.worktrees/techdebt-high` blijft nog even staan tot de orchestrator opruimt.)
- [ ] Nog NIET gepusht naar `origin/main` (wacht op akkoord user; origin staat op "Rollback").
      Lokaal staat `main` nu 5 commits voor op `origin/main`.

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
AUTH (BESLOTEN: settings-scherm komt achter een inlogmuur). Voorgestelde aanpak,
wacht op bevestiging van 4 keuzes door user:
- Wachtwoord NOOIT plain opslaan — alleen een bcrypt (of argon2) hash in de DB.
- `users`/`admin`-tabel in dezelfde DB als de streams.
- Seed bij verse installatie (voorstel A): idempotente startup-seed vanuit env var
  `ADMIN_PASSWORD` (in .env / compose). Bij opstart: bestaat er een admin? Zo nee,
  aanmaken met de hash van ADMIN_PASSWORD. Geen secret in code of DB-seed. Sluit aan
  op bestaand .env-patroon + de `.env.example` die al in .gitignore-uitzondering staat.
- Login-flow (voorstel): POST /auth/login -> httpOnly session-cookie (geen JWT; overkill).
  Werkt same-origin via nginx, geen CORS-gedoe.
- Alleen de BEHEER-endpoints (POST/PUT/DELETE /api/streams) achter auth-middleware;
  de publieke lees-endpoint /api/settings (selector) blijft open.
BESLOTEN keuzes (user, 2026-10-23):
- Cron + retentie OOK via het settings-scherm (NIET env-only). Dus deze config komt in de DB,
  en de workers moeten de waarden kunnen herladen zonder herstart (recorder plant zijn cron
  opnieuw in bij wijziging). Bewust gekozen complexiteit.
- Sessie-duur: gangbare default (bv. 7 dagen, httpOnly cookie).
- Write-path validatie: JA — folder-allowlist (^[a-z0-9_-]+$) + path.resolve-containment,
  want folder wordt user-input via het scherm.
- Graceful shutdown: netjes afkappen — SIGTERM/SIGINT handler sluit lopende ffmpeg netjes af.
  (Raakt recorder.js; plannen t.o.v. recorder-catchup + settings-db.)
- Logging: realtime log-schermpje in het admin/settings-scherm (logs streamen naar frontend,
  bv. via Server-Sent Events). Gebruikelijke, niet te uitgebreide logging; later bijsturen.
- Push-beleid: ik MAG pushen naar origin/main na elke geslaagde merge (user akkoord).
- DB: SQLite op een persistent volume (./data/app.db bind-mount, overleeft rebuild).
  Postgres bewust NIET (te veel overhead voor 1 beheerder + handvol streams).
- Hashing: Argon2id (npm `argon2`). Post-quantum bewust NIET — PQC gaat over asymmetrische
  crypto (RSA/ECC/Shor); wachtwoord-hashing is hash-gebaseerd, Grover halveert alleen de
  bit-sterkte. Argon2id is de OWASP-aanbeveling 2026. Post-quantum hashing is academisch/overkill.
- Seed: kale opstart => idempotent één admin-user, username `admin` / wachtwoord `admin`
  (Argon2id-hash). GEEN env-override (puur admin/admin, user-keuze).
- `users`-tabel (schema klaar voor meerdere users), nu met één admin geseed.
- Wachtwoord-wijzigen in het settings-scherm (om van admin/admin af te komen).
- Auth: httpOnly session-cookie, opgezet zodat het later óók functies op het HOOFDscherm
  kan afschermen (niet alleen settings).
- Schrijf-endpoints (POST/PUT/DELETE /api/streams + auth) achter de muur; publieke lees-
  endpoint /api/settings (selector) blijft open.
SCOPE-AANSCHERPING (user, 2026-10-23): settings.json moet NA deze workflow HELEMAAL weg.
Gevolg — settings.json bevat nu twee dingen, die allebei een nieuw huis krijgen IN deze workflow:
- Streams -> SQLite DB. De workers (recorder/cleaner/peakfilegenerator) moeten dus óók uit de
  DB gaan lezen i.p.v. settings.json (de eerder geparkeerde "fase 2" wordt nu onderdeel hiervan,
  want het bestand mag niet blijven bestaan).
- Cron-minuten + log_retention (recorder_minute/cleaner_minute/peakfile_minute/log_retention)
  -> env vars in docker-compose.yml (zet-en-vergeet infra-config, hoort niet in de DB).
- De settings.json bind-mounts uit alle services in docker-compose.yml verwijderen.
GEVOLG VOOR VOLGORDE: omdat dit nu óók recorder.js raakt, botst het met de recorder-inhaal-
opname. BESLUIT user (2026-10-23): Optie Y — TOCH PARALLEL starten; het merge-conflict op
recorder.js wordt achteraf handmatig opgelost (recorder-inhaalopname voegt startup-logica toe,
settings-workflow zet de stream-bron om naar de DB).

### 7. .env netjes verwerken (user-wens, meenemen in/rond de settings-workflow)
- [ ] `.env.example` toevoegen (gaat WEL mee naar git, met dummy-waarden). Echte `.env` blijft
      gitignored (uitzondering `!.env.example` staat al in .gitignore).
- [ ] Frontend-poort beoordelen voor productie: huidige `${PORT}:80` in compose + nginx op 80
      intern is gangbaar, maar check: ontbrekende default als PORT niet gezet is, geen TLS/HTTPS,
      reverse-proxy ervoor. Netjes maken waar nodig.

AANDACHTSPUNT (uit FEAT-003 notificatie) — OPGELOST op `techdebt-high` tijdens de cross-FEAT
integratieverificatie: `/api/settings2` gooide 500 (ENOENT) als een stream-subfolder in `audio/`
nog niet bestond (verse stack). `folderContent()` behandelt ENOENT nu als lege logs (`return {}`),
dus het endpoint geeft weer 200 (geneste tree, leeg per station). Verdere `/settings2`-opschoning
(impliciete global, dubbel transform-pass, lekkend `test`-veld) blijft bij het API-werk in de
settings-workflow.

AUTOMATISCH STARTEN (user-opdracht): zodra de tech-debt-workflow (wf_0322f1b98fd9ecf7) klaar
is EN gemerged naar main, start ik UIT MEZELF twee PARALLELLE workflows (Optie Y):
  1. recorder-catchup  — branch recorder-catchup: startup-inhaalopname voor het restant van
     het huidige uur per stream (zie item 6). Raakt src/recorder/recorder.js.
  2. settings-db       — branch settings-db: SQLite + Argon2id admin/admin + session-cookie +
     stream-CRUD + settings-scherm; settings.json VOLLEDIG weg (streams->DB incl. workers,
     cron-minuten/retentie->env vars, mounts eruit); + .env.example + productie-poort-check
     (/settings2-ENOENT-randgeval is al opgelost op `techdebt-high`). Raakt api/frontend/compose
     EN src/recorder/recorder.js.
     + API-OPSCHONING (user-wens): maak de API netter. Concreet:
       - /settings2 opschonen: transformData niet meer per-request definiëren, dubbele
         transform-pass samenvoegen, impliciete global transformedJson (geen const/let) weg
         = gedeelde mutable state tussen requests, en het lekkende debug-veld `test`
         (intern absoluut pad) uit de response halen.
       - consistente error-handling + response-vormen over endpoints; nette express.json() limit;
         dode/dubbele route-mounts opruimen (check /logger-alias is echt weg).
       - logische mapstructuur (routes/controllers/lib) nu de API een echte service wordt
         met DB + auth. Combineren met de DB-omzetting want databron van /settings2 verandert
         toch (streams uit DB i.p.v. settings.json).
Na beide merges: recorder.js-conflict handmatig oplossen.

### 6. Recorder: inhaal-opname bij opstarten  (AFGEROND — gemerged naar `main`, lokaal, NIET gepusht)
Status: GEÏMPLEMENTEERD op branch `recorder-catchup`, APPROVED, fast-forward gemerged in `main`
(`main` == `recorder-catchup` == c36d630, rebase op `main`-tip 5625599 was een no-op/clean).
NIET gepusht. Worktree `.worktrees/recorder-catchup` blijft staan tot de orchestrator opruimt.
Commit op `main`: c36d630 `feat(recorder): catch-up recording for current hour on startup`.
Implementatie: nieuwe pure module `src/recorder/time-helpers.js` (`secondsUntilNextHour` +
`currentHourStamp` als single source of truth voor filenames), `recordStream` kreeg een optionele
`durationSeconds=3600` param (default gedrag-identiek aan de oude `'01:00:00'`), en een additieve
startup-inhaalblok (outer + per-stream try/catch) dat na de cron-registratie per stream checkt of
er al een opname voor het huidige uur is en zo niet opneemt voor het restant. Stream/settings-lees
bewust ONGEMOEID gelaten (zelfde settings.json-pad) om de merge met settings-db minimaal te houden.
`node:test`-suite `time-helpers.test.js` toegevoegd (7/7), Dockerfile.recorder kopieert de helper.
Geverifieerd: `node --check` op recorder.js + time-helpers.js OK (node:26-bookworm container) na merge.
User-wens: bij het opstarten moet de recorder voor elke stream checken of er al een opname
bestaat voor het HUIDIGE uur (`<folder>/<folder>-YYYY-MM-DD-HH.mp3`). Zo niet: meteen beginnen
op te nemen voor het RESTANT van het uur (bv. om 14:37 → ~23 min, tot 15:00). Zo ja: niks doen.
Daarna neemt de normale cron op het hele uur het weer over.
- [x] Startup-check per stream + opname voor het resterende deel van het uur.
- [x] Zelfde try/catch-resilience als de scheduled runs (sluit aan op tech-debt-item 3b).
- Aandachtspunt: "bestaat = overslaan" telt ook een half/corrupt bestand als bestaand
  (van een eerdere crash); voor nu simpel houden, perfectie raakt aan graceful-shutdown.
- Mag PARALLEL aan het settings-scherm (raakt andere code: recorder-logica vs API+DB+frontend).
  Leest gewoon settings.json zoals nu; pas later evt. uit de DB.

### 8. Uren-selector op basis van bestaande uren + opnames in de DB voor analyse (user-wens)
Twee delen, los van elkaar te doen:

Quick win (frontend; kan mee in settings-workflow of los, GEEN DB nodig):
- [ ] De uren-dropdown toont nu hardcoded 00-23. Vervang door alleen de uren die daadwerkelijk
      bestaan voor de gekozen stream + dag. Die data zit al in /settings2 (browse-boom
      station -> jaar -> maand -> dag -> uren[]). Koppel de selector daaraan i.p.v. hardcoded.
      (Idem evt. de dag-selector beperken tot dagen met opnames.)

Grotere feature (NÁ de DB er is; aparte latere workflow):
- [ ] `recordings`-tabel in de DB: per opname stream/datum/uur + duur + bestandsgrootte +
      status (compleet/partieel). Vervangt het filesystem-scannen van /settings2 door snelle,
      rijke queries.
- [ ] Recorder schrijft een rij bij elke opname; cleaner verwijdert de rij bij opruimen;
      peakfilegenerator kent de duur (kan die invullen/bijwerken).
- [ ] Analyse-endpoints op de API (totale opname-tijd, gaten/missende uren, opslag per stream,
      gemiddelde duur) + een analyse-view in de frontend.
- Raakt alle lagen (recorder/cleaner/peakfilegenerator/api/frontend); natuurlijke vervolgstap
  zodra de SQLite-DB bestaat. Bewust NIET in de eerste settings-DB-workflow (die is al groot).

### 9. Echte teststrategie (user-wens)
Huidige staat: er is WEL al wat testing, maar mager en lukraak (alleen pure helpers die
toevallig bij bugfixes betrokken waren):
- `node:test` in src/cleaner (validateMinute/validateRetentionHours), src/peakfilegenerator
  (extractFileDateTime), src/api (buildBrowseTree), src/recorder (secondsUntilNextHour).
- src/frontend heeft een vitest-test.
Wat ontbreekt (= het echte werk):
- [ ] Samenhangende teststrategie i.p.v. losse testjes: afspraken over wat we unit vs
      integratie testen, waar tests staan, hoe je ze draait (per service + overkoepelend).
- [ ] Endpoint-/integratietests voor de API (login/auth-flow, stream-CRUD, /settings, /settings2,
      /util/selection-export) i.p.v. alleen pure helpers. Groeit mee met de DB/auth-features.
- [ ] Frontend: meer dan de ene render-test (interactie met wavesurfer-knoppen, settings-scherm,
      login-flow).
- [ ] Workers: testbare logica verder isoleren en dekken (nu alleen enkele helpers).
- [ ] CI die tests bij elke push/PR afdwingt (GitHub Actions) — sluit aan op item 3 (Renovate)
      en op "ik wil gewoon bij zijn".
- [ ] Coverage-beeld (welke lib, welke drempel) bepalen.
Volgorde: deels organisch (elke feature-workflow voegt nu al tests toe), maar een bewuste
teststrategie + CI als eigen stap plannen. Keuzes (testrunner-consistentie node:test vs vitest
overal, coverage-tool, CI-provider) nog te bepalen met user.

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
- [x] `peakfilegenerator.js`: `filename.match(/…/)[0]` crasht op elke `.mp3` zonder datumpatroon
      (bv. `temp-*.mp3`) en breekt de hele run af. Fix: match guarden. GEFIXT op `techdebt-high`
      (FEAT-002, commit 446b46f): `extractFileDateTime` geeft `null` i.p.v. `[0]` op null; bestanden
      zonder datumpatroon worden overgeslagen.
- [x] Geen `restart:`-policy en geen healthchecks in `docker-compose.yml`; gecombineerd met
      `process.exit(1)` als enige foutafhandeling is een crash permanent. Fix: `restart:
      unless-stopped` + healthcheck per service, en niet meer blind exiten bij transiente fouten.
      GEFIXT op `techdebt-high` (FEAT-003, commit ff28ff3): `restart: unless-stopped` + healthchecks
      op alle vijf services, cron-callbacks in try/catch (geen crash op transiente fouten),
      heartbeats + `GET /healthz`.
- [x] `cleaner/deletefiles.js`: `thresholdTime` wordt één keer bij boot berekend → retentievenster
      groeit met elk draaiuur. Plus `log_retention` is gevalideerd op `< 60`, dus >59u retentie
      kan niet (readme-voorbeeld gebruikt 168). Fix: threshold in de cron-callback berekenen en
      `log_retention` een eigen zinnige bovengrens geven. GEFIXT op `techdebt-high` (FEAT-002,
      commit 446b46f): `thresholdTime` per cron-run herberekend; `validateRetentionHours` staat
      1..8760u toe (168 werkt nu).
- [x] Geen tests in de originele services (recorder/cleaner/peakfilegenerator/API). Fix: minimale
      `node:test`-suite op de pure logica (minuut-validatie, datumregex, `/settings2`-transform,
      retentie-threshold). GEDAAN op `techdebt-high` (FEAT-004): drie suites op de pure helpers,
      geen nieuwe deps, `test`-script in de drie `package.json`'s; alle suites exit 0 in
      node:26-bookworm.

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
- [ ] `readme.txt` → `README.md`; poort-voorbeeld (9702 in de tekst vs 9703 in `.env`) klopt nog
      niet met de echte config. Retentie-voorbeeld (168) is nu WEL consistent: `techdebt-high`
      verruimde `log_retention` naar 1..8760u, dus de readme-waarde 168 is geldig geworden.
- [ ] Placeholder-metadata (`author: "Your Name"`); frontend-`package.json` mist name/version/scripts.
- [ ] `.DS_Store` in de repo-root; toevoegen aan `.gitignore`.
