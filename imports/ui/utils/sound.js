// Play notification sound from public assets.

let cachedObjectUrl = null;

function getOrCreateBeepObjectUrl() {
  if (cachedObjectUrl) return cachedObjectUrl;
  // Served by Meteor from public/sounds/notify.mp3
  cachedObjectUrl = '/sounds/notify.mp3';
  return cachedObjectUrl;
}

export function playBeep(volume = 0.5) {
  const src = getOrCreateBeepObjectUrl();
  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, volume));
  const p = audio.play();
  if (p !== undefined && typeof p.catch === 'function') {
    p.catch((err) => {
      console.error('Audio play failed', err);
    });
  }
  return audio;
}
