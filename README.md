# audiostreamlogger

Een multi-service Docker-applicatie die internet-audiostreams (radiostations) per uur
opneemt, waveform-peakfiles genereert, oude opnames opruimt, en een webinterface
serveert om de opnames te bekijken, af te spelen en te downloaden.

De services worden met Docker Compose beheerd.

## Architectuur

De applicatie bestaat uit vijf services (broncode onder `src/`):

| Service | Map | Rol |
| --- | --- | --- |
| `recorder` | `src/recorder/` | Neemt elke stream elk uur op (ffmpeg). Haalt bij het opstarten het resterende deel van het huidige uur in als er nog geen opname is. |
| `cleaner` | `src/cleaner/` | Verwijdert opnames ouder dan de ingestelde bewaartermijn. |
| `peakfilegenerator` | `src/peakfilegenerator/` | Genereert waveform-peakfiles (`audiowaveform`) uit de mp3's, voor snelle weergave in de frontend. |
| `api` | `src/api/` | Express-API: levert de streamlijst en de opname-boom, en verzorgt het knippen/downloaden van fragmenten. Draait intern op poort 3000, niet publiek. |
| `frontend` | `src/frontend/` | React + Vite single-page app, geserveerd door nginx. nginx serveert ook de audio en proxyt `/api` + `/util` door naar de `api`-service (same-origin, dus geen CORS nodig). |

De `recorder`, `cleaner` en `peakfilegenerator` zijn cron-gebaseerde workers die op een
ingesteld minuut per uur draaien. De audio wordt gedeeld via een volume (`./audio`).

## Vereisten

- Docker
- Docker Compose (v2, het `docker compose`-subcommando)

## Aan de slag

1. Clone de repository:

   ```sh
   git clone https://github.com/denhoo4/audiostreamlogger.git
   cd audiostreamlogger
   ```

2. Maak een `.env` aan met de poort waarop de webinterface bereikbaar moet zijn
   (zie `.env.example`):

   ```sh
   cp .env.example .env
   # pas PORT aan indien gewenst
   ```

3. Zorg voor een `settings.json` in de root (zie "Configuratie" hieronder).

4. Bouw en start de applicatie:

   ```sh
   docker compose up --build
   ```

5. Open de webinterface op `http://localhost:<PORT>` (standaard `http://localhost:9703`).

## Stoppen

In de terminal waar `docker compose up` draait: `Ctrl+C`. Of, om de containers te stoppen
en op te ruimen:

```sh
docker compose down
```

## Configuratie

### `.env`

De poort van de webinterface wordt bepaald in `.env`:

```
PORT=9703
```

De echte `.env` staat niet in git; gebruik `.env.example` als sjabloon.

### `settings.json`

De applicatie leest zijn configuratie uit `settings.json` in de root. Dit bestand
specificeert de op te nemen streams en de minuut-van-het-uur waarop elke worker draait,
plus de bewaartermijn voor opnames.

`settings.json` staat niet in git (het wordt als volume in de containers gemount).

Voorbeeld:

```json
{
  "cleaner": {
    "log_retention": 168,
    "cleaner_minute": 10
  },
  "peakfilegenerator": {
    "peakfile_minute": 5
  },
  "recorder": {
    "recorder_minute": 0
  },
  "streams": [
    {
      "country": "Netherlands",
      "name": "Glow_FM",
      "folder": "glowfm",
      "url": "https://stream.glowfm.nl/glowfm.mp3"
    },
    {
      "country": "Netherlands",
      "name": "RTV_Connect",
      "folder": "rtvconnect",
      "url": "https://stream.rtvconnect.nl/radio/8000/ffm-320-mp3"
    }
  ]
}
```

Velden:

- `recorder.recorder_minute`, `peakfilegenerator.peakfile_minute`, `cleaner.cleaner_minute`:
  de minuut van het uur (0–59) waarop de betreffende worker draait.
- `cleaner.log_retention`: bewaartermijn van opnames in **uren** (bijvoorbeeld `168` voor
  zeven dagen).
- `streams`: de op te nemen stations. `folder` is de submap onder `audio/` waarin de
  opnames van dat station terechtkomen; opnamebestanden heten
  `<folder>/<folder>-YYYY-MM-DD-HH.mp3`.

## Opnamestructuur

Opnames worden opgeslagen onder `audio/<folder>/` met de naam
`<folder>-YYYY-MM-DD-HH.mp3` (lokale tijd, tijdzone `Europe/Amsterdam`). Per mp3 wordt een
`.json`-peakfile gegenereerd voor de waveform-weergave in de frontend.

## Ontwikkeling

De frontend is een React + Vite + TypeScript-app in `src/frontend/`. Lokaal draaien:

```sh
cd src/frontend
npm install
npm run dev
```

Tests (waar aanwezig) draaien per service met het ingebouwde `node --test`, en in de
frontend met Vitest.

> **Let op:** dit project is volop in ontwikkeling. Een databasegestuurd beheerscherm
> (met inlog) voor de streams en configuratie is in de maak; deze README beschrijft de
> huidige `settings.json`-gebaseerde opzet en wordt bijgewerkt zodra dat landt.
