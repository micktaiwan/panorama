// Lightweight beep generator that synthesizes a short WAV at runtime.
// Avoids external files and extra dependencies.

let cachedObjectUrl = null;

function getOrCreateBeepObjectUrl() {
  if (cachedObjectUrl) return cachedObjectUrl;
  const sampleRate = 44100;
  const durationSeconds = 0.12; // ~120ms
  const frequencyHz = 880; // A5
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2; // 16-bit
  const numChannels = 1;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  // RIFF header
  function writeString(s) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }
  function writeUint32(v) { view.setUint32(offset, v, true); offset += 4; }
  function writeUint16(v) { view.setUint16(offset, v, true); offset += 2; }

  writeString('RIFF');
  writeUint32(36 + dataSize);
  writeString('WAVE');
  writeString('fmt ');
  writeUint32(16); // PCM chunk size
  writeUint16(1); // PCM format
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(16); // bits per sample
  writeString('data');
  writeUint32(dataSize);

  // Sine wave samples with short fade in/out to avoid clicks
  const amplitude = 0.4; // scale 0..1
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 200) * Math.min(1, (numSamples - i) / 400);
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude * envelope;
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  cachedObjectUrl = URL.createObjectURL(blob);
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
