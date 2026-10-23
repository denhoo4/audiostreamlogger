This is the audiostreamlogger!

This project contains a multi-service Docker application for recording, cleaning, generating peak files, and serving a frontend for audio files. The setup uses Docker Compose to manage the services and their interactions.

Prerequisites

	•	Docker: Install Docker
	•	Docker Compose: Install Docker Compose (the `docker compose` v2 plugin)

Project Structure

	•	recorder: Service to record audio files.
	•	cleaner: Service to clean up audio files.
	•	peakfilegenerator: Service to generate peak files from audio files.
	•	api: Node + Express service exposing /api and /util. Internal only (port 3000,
		not published); reached by the frontend's nginx reverse proxy. Lives in api/.
	•	frontend: nginx serving the React (Vite) SPA from frontend-react/, built via a
		multi-stage Docker build. Serves /audio directly and reverse-proxies /api + /util
		to the api service, so the browser sees a single origin (no CORS). Published on ${PORT}.
	•	audio: Directory to store audio files.
	•	settings.json: Configuration file for the application.

	Architecture note: the API layer used to live inside the frontend container. It has
	been split into its own api service. The legacy webpack UI (frontend/index.js +
	frontend/web/) has been replaced by the React app in frontend-react/; frontend/ now
	only holds the nginx config. The frontend's nginx proxies /api and /util to api:3000.

Getting Started

    1.	Clone the repository:
        git clone https://github.com/yourusername/audiostreamlogger.git
        cd audiostreamlogger

    2.	Build and run the application:
        docker compose up --build

    3.	Access the application:
        Open your browser and navigate to http://localhost:9702.


Stopping the Application

    To stop the application, press Ctrl+C in the terminal where docker compose up is running, or run:
        docker compose down

Configuration

    The application is configured using the settings.json file. This file specifies the streams to be recorded, including their country, name, folder, and URL. Also the log retention can be adjusted.

    Example settings.json:

    {
    "log_retention":168,
    "streams":[
        {
            "country":"Netherlands",
            "name":"Glow_FM",
            "folder":"glowfm",
            "url":"https://stream.glowfm.nl/glowfm.mp3"
        },
        {
            "country":"Netherlands",
            "name":"RTV_Connect",
            "folder":"rtvconnect",
            "url":"https://stream.rtvconnect.nl/radio/8000/ffm-320-mp3"
        }
    ]
    }

    In the .env file the port the webserver is hosted on can be changed. This is an example:

    PORT=9703