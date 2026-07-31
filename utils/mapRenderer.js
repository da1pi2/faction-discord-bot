const path = require('path');
const sharp = require('sharp');

const MAP_PATH = path.join(__dirname, '..', 'images', 'map_clear.png');
const MARKERS = {
  location: path.join(__dirname, '..', 'images', 'location.png'),
  defend: path.join(__dirname, '..', 'images', 'defend.png'),
  attack: path.join(__dirname, '..', 'images', 'attack.png') // <-- Aggiunta di attack.png
};
const MAX_X = 2078;
const MAX_Y = 3308;

// Larghezza del marker come percentuale della larghezza della mappa,
// invece di un valore fisso in pixel (che sembrava minuscolo).
const MARKER_WIDTH_RATIO = 0.07;

// --- NUOVE COSTANTI PER IL FINE-TUNING DEL MARKER ---
// Valori negativi spostano il marker a sinistra (X) e in alto (Y).
// Modifica questi due valori per aggiustare millimetricamente la posizione.
const MARKER_OFFSET_X = -130; // Sposta a sinistra
const MARKER_OFFSET_Y = -40; // Sposta in alto

// Nel gioco l'origine (0,0) e' in basso a sinistra e Y cresce verso l'alto.
// Nei pixel di un'immagine l'origine e' in alto a sinistra e Y cresce verso
// il basso: va quindi invertito l'asse Y prima di posizionare il marker.
const INVERT_Y = true;

// La mappa e' stata composta a mano da piu screenshot e NON copre l'intero
// range di coordinate del gioco: manca una fascia di mare a sinistra, quindi
// il pixel 0 dell'immagine corrisponde circa alla coordinata di gioco X_OFFSET
// (non alla coordinata 0). Valore approssimativo, regolabile a occhio.
const X_OFFSET_GAME = 200;

// Se in futuro noti che anche l'asse Y e' leggermente tagliato, puoi
// aggiungere un Y_OFFSET_GAME analogo e sottrarlo allo stesso modo.
const Y_OFFSET_GAME = 0;

function clampCoordinate(value, maxValue) {
  return Math.max(0, Math.min(value, maxValue));
}

function parseCoordinatePair(input) {
  if (typeof input !== 'string') return null;

  const match = input.trim().match(/^\(?\s*(\d{1,4})\s*,\s*(\d{1,4})\s*\)?$/);
  if (!match) return null;

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}

async function renderMapWithMarkers(markers) {
  const mapMeta = await sharp(MAP_PATH).metadata();

  if (!mapMeta.width || !mapMeta.height) {
    throw new Error('Unable to read map image dimensions');
  }

  // Range effettivo di coordinate di gioco coperto dall'immagine ritagliata.
  const gameRangeX = MAX_X - X_OFFSET_GAME;
  const gameRangeY = MAX_Y - Y_OFFSET_GAME;

  // Scala: pixel reali dell'immagine / range di coordinate di gioco coperto.
  // Usando le dimensioni reali del file (non assumendo 2078x3308) il calcolo
  // resta corretto anche se l'immagine e' stata ritagliata o compressa.
  const scaleX = mapMeta.width / gameRangeX;
  const scaleY = mapMeta.height / gameRangeY;

  const markerWidth = Math.max(24, Math.round(mapMeta.width * MARKER_WIDTH_RATIO));

  // 1. Pre-carichiamo in memoria solo i buffer delle immagini dei marker effettivamente usati in questa chiamata
  const loadedMarkers = {};
  for (const marker of markers) {
    const type = marker.type || 'location';
    if (!loadedMarkers[type]) {
      // Se il tipo non esiste nel dizionario, usa 'location' di default
      const mPath = MARKERS[type] || MARKERS['location'];
      const markerBuffer = await sharp(mPath)
        .resize({ width: markerWidth, withoutEnlargement: false })
        .png()
        .toBuffer();
      
      const markerMeta = await sharp(markerBuffer).metadata();
      loadedMarkers[type] = { buffer: markerBuffer, meta: markerMeta };
    }
  }

  // 2. Posizioniamo i marker sulla mappa
  const composite = markers.map((marker) => {
    const gameX = clampCoordinate(marker.x, MAX_X);
    const gameY = clampCoordinate(marker.y, MAX_Y);

    const adjustedX = clampCoordinate(gameX - X_OFFSET_GAME, gameRangeX);
    const adjustedY = clampCoordinate(gameY - Y_OFFSET_GAME, gameRangeY);

    const pixelX = adjustedX * scaleX;
    const pixelYRaw = adjustedY * scaleY;
    const pixelY = INVERT_Y ? (mapMeta.height - pixelYRaw) : pixelYRaw;

    // Recupera il buffer e la dimensione del marker specifico
    const type = marker.type || 'location';
    const { buffer: markerBuffer, meta: markerMeta } = loadedMarkers[type];

    const left = Math.max(
      0,
      Math.min(
        Math.round(pixelX - markerMeta.width / 2) + MARKER_OFFSET_X, 
        mapMeta.width - markerMeta.width
      )
    );
    
    const top = Math.max(
      0,
      Math.min(
        Math.round(pixelY - markerMeta.height) + MARKER_OFFSET_Y, 
        mapMeta.height - markerMeta.height
      )
    );

    return {
      input: markerBuffer,
      left,
      top,
    };
  });

  const imageBuffer = await sharp(MAP_PATH)
    .composite(composite)
    .webp({ quality: 92 })
    .toBuffer();

  return { imageBuffer };
}

module.exports = {
  MAX_X,
  MAX_Y,
  clampCoordinate,
  parseCoordinatePair,
  renderMapWithMarkers,
};