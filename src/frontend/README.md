# audiostreamlogger — nieuwe React frontend

Een nieuwe, "basic" frontend voor Dé radiologger, gebouwd met **React + Vite + TypeScript**.
Vervangt de oude, met webpack gebundelde frontend (`frontend/web/`). De functionaliteit
is 1:1 overgenomen; alle teksten blijven Nederlands. `wavesurfer.js` v7 + de Regions-plugin
zijn behouden; `flatpickr` en `lodash` zijn eruit gehaald.

## Waar leeft deze app

- Nieuwe app: `frontend-react/` (deze map), in de worktree op branch `frontend-react`.
- De oude app (`frontend/web/`, `frontend/index.js`, `frontend/routes/`) blijft **onaangeraakt**.
  De backend (Express) wordt door deze app niet gewijzigd; het is een pure client.

## Lokaal draaien (development)

```bash
cd frontend-react
npm install
npm run dev      # start de Vite dev-server (standaard http://localhost:5173)
```

De dev-server draait op een andere poort dan de backend (poort 80). Omdat de app
dezelfde origin verwacht voor `/api`, `/util` en `/audio`, kun je tijdens development
het beste via de productie-backend serveren (zie hieronder) of een Vite dev-proxy
toevoegen in een latere stap.

## Productie build

```bash
cd frontend-react
npm install
npm run build    # tsc -b && vite build  ->  statische output in dist/
npm run preview  # optioneel: lokaal de productie-build bekijken
```

De build produceert statische bestanden in `frontend-react/dist/` (`index.html` +
gehashte JS/CSS in `dist/assets/`).

## Tests

```bash
cd frontend-react
npm run test -- --run
```

Een smoke-test (`src/App.test.tsx`, Vitest + Testing Library + jsdom) rendert de app
tegen een gestubde, lege `/api/settings` (`[]`) en `/api/settings2` (`{}`), controleert
dat elke control aanwezig is (met de juiste id's/labels) en dat er geen `console.error`
optreedt tijdens render.

## Productie-serving (FOLLOW-UP, niet in deze workflow)

De oude frontend werd als statische map door Express geserveerd
(`app.use(express.static(path.join(__dirname, 'web')))` in `frontend/index.js`) en in
Docker via `Dockerfile.frontend`. Het inhaken van deze nieuwe build (bijv. `dist/`
serveren i.p.v. `web/`, of de Dockerfile aanpassen) is een **vervolgstap**. Die raakt
bestanden die momenteel door de `security-update`-branch worden beheerd
(`frontend/index.js`, `frontend/web/nginx.conf`, `package.json`), dus is bewust
buiten deze workflow gehouden.

## Herstelde wavesurfer-configuratie

Uit de oude geminificeerde bundle (`frontend/web/main.js`) herstelde `WaveSurfer.create(...)`:

```js
WaveSurfer.create({
  container: "#waveform",
  waveColor: "violet",
  progressColor: "purple",
  normalize: true,
}).registerPlugin(RegionsPlugin.create())
```

| Optie            | Waarde     | Opmerking                                              |
| ---------------- | ---------- | ------------------------------------------------------ |
| `waveColor`      | `"violet"` |                                                        |
| `progressColor`  | `"purple"` |                                                        |
| `normalize`      | `true`     |                                                        |
| `barWidth`       | (default)  | niet gezet door de oude app → v7-default               |
| `barGap`         | (default)  | niet gezet → v7-default                                |
| `barHeight`      | (default)  | niet gezet → v7-default                                |
| `cursorColor`    | (default)  | niet gezet → v7-default                                |
| `height`         | (default)  | niet gezet → v7-default (128)                          |

De Regions-plugin wordt geregistreerd **zonder** `enableDragSelection`: een selectie
wordt gemaakt via de knoppen Selection Start / Selection End op de playhead-positie,
precies zoals in de oude app. Er bestaat telkens één region tegelijk; die is
`drag: true, resize: true`.

## Geconsumeerde API-endpoints (backend ongewijzigd)

| Methode | Endpoint                               | Gebruik                                                                                  |
| ------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET     | `/api/settings`                        | Vult de stream-selector (`value = folder`, tekst = `name` met `_` → spatie).             |
| GET     | `/api/settings2`                       | Getypte client beschikbaar (`getSettings2`), **nog niet** in de UI gebruikt.             |
| GET     | `/audio/<folder>/<folder>-Y-M-D-H.json`| Vooraf berekende peaks; geprobeerd vóór het decoderen van de mp3.                        |
| GET     | `/audio/<folder>/<folder>-Y-M-D-H.mp3` | Audio; `#downloadbutton` wijst hiernaar en wordt als fallback door wavesurfer gedecodeerd.|
| POST    | `/util/selection-export`               | Body `{ station_id, year, month, day, hour, startTime, endTime }` (seconden); geeft mp3. |

## Opmerkingen / aannames

- **Selector-bron:** de oude app gebruikte `/api/settings` voor de dropdown; dat is
  hier 1:1 overgenomen. `/api/settings2` (de geneste browse-tree) is als getypte client
  beschikbaar voor later werk maar niet in de UI gekoppeld.
- **`dateTimeSelector`:** de oude flatpickr gebruikte `Y-m-d H:i`. Hier is een native
  `<input type="datetime-local">` gebruikt; `new Date(value)` parset de waarde correct,
  dus de uur-extractie voor de mp3-URL blijft ongewijzigd.
- **lodash vervangen:** `round(10*x)/10` → `Math.round(x*10)/10` (`round1` in `App.tsx`).
