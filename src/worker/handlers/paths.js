// Single shared audio-root constant for both handlers (design §2.2.1).
//
// The originals derived the audio root from path.join(__dirname, '/audio'),
// which worked only because each script sat at the image root. In the new
// layout the handlers live at /usr/src/app/handlers/, so the __dirname form is
// deliberately NOT carried over — it would resolve to the wrong directory. Both
// handlers import this one constant instead; the AUDIO_DIR env override keeps
// them testable against a temp dir.
const AUDIO_DIR = process.env.AUDIO_DIR || '/usr/src/app/audio';

module.exports = { AUDIO_DIR };
