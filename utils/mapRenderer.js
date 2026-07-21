const path = require('path');
const sharp = require('sharp');

const MAP_PATH = path.join(__dirname, '..', 'images', 'map_dragonfire.png');
const MARKER_PATH = path.join(__dirname, '..', 'images', 'location.png');
const MAX_X = 2078;
const MAX_Y = 3308;
const MARKER_WIDTH = 20;

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

function toPixel(value, maxValue, size) {
  if (size <= 1) return 0;
  return Math.round((value / maxValue) * (size - 1));
}

async function renderMapWithMarkers(markers) {
  const [mapMeta, markerBuffer] = await Promise.all([
    sharp(MAP_PATH).metadata(),
    sharp(MARKER_PATH)
      .resize({ width: MARKER_WIDTH, withoutEnlargement: true })
      .png()
      .toBuffer(),
  ]);

  const markerMeta = await sharp(markerBuffer).metadata();

  if (!mapMeta.width || !mapMeta.height || !markerMeta.width || !markerMeta.height) {
    throw new Error('Unable to read map or marker image dimensions');
  }

  const composite = markers.map((marker) => {
    const x = clampCoordinate(marker.x, MAX_X);
    const y = clampCoordinate(marker.y, MAX_Y);
    const pixelX = toPixel(x, MAX_X, mapMeta.width);
    const pixelY = toPixel(y, MAX_Y, mapMeta.height);
    const left = Math.max(0, Math.min(Math.round(pixelX - markerMeta.width / 2), mapMeta.width - markerMeta.width));
    const top = Math.max(0, Math.min(Math.round(pixelY - markerMeta.height), mapMeta.height - markerMeta.height));

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