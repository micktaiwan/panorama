import { Meteor } from 'meteor/meteor';

// Initialize Qdrant collection on server start (if configured)
Meteor.startup(async () => {
  const url = Meteor.settings && Meteor.settings.qdrantUrl;
  if (!url) {
    // Qdrant not configured; skip
    console.warn('[qdrant] Qdrant not configured; skipping initialization');
    return;
  }

  // Optional settings overrides
  const collectionName = (Meteor.settings.qdrantCollectionName || 'panorama');
  const vectorSize = Number(Meteor.settings.qdrantVectorSize || 1536);
  const distance = (Meteor.settings.qdrantDistance || 'Cosine');

  try {
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    const client = new QdrantClient({ url });

    // Check health (best-effort)
    try {
      // Health endpoint is not in the client; do a lightweight fetch
      const resp = await fetch(`${url.replace(/\/$/, '')}/healthz`).catch(() => null);
      if (!resp || !resp.ok) {
        console.warn('[qdrant] Health check failed or non-OK response');
      }
    } catch (e) {
      console.warn('[qdrant] Health check threw an error:', e);
    }

    // Ensure collection exists with expected vector parameters
    let exists = false;
    try {
      const info = await client.getCollection(collectionName);
      exists = !!info;
    } catch (e) {
      console.warn(`[qdrant] getCollection('${collectionName}') failed (will attempt create):`, e && e.message ? e.message : e);
      exists = false;
    }

    if (!exists) {
      await client.createCollection(collectionName, {
        vectors: { size: vectorSize, distance }
      });
      console.log(`[qdrant] Created collection '${collectionName}' (size=${vectorSize}, distance=${distance})`);
    } else {
      // Optionally validate vector size/distance (warn if mismatch)
      try {
        const info = await client.getCollection(collectionName);
        const cfg = info && info.config && info.config.params && info.config.params.vectors;
        const size = cfg && (cfg.size || (cfg.config && cfg.config.size));
        const dist = cfg && (cfg.distance || (cfg.config && cfg.config.distance));
        if (Number(size) !== vectorSize || String(dist).toLowerCase() !== String(distance).toLowerCase()) {
          console.warn(`[qdrant] Collection '${collectionName}' exists but vector config differs (have size=${size}, distance=${dist}; expected size=${vectorSize}, distance=${distance})`);
        }
        console.log(`[qdrant] Collection '${collectionName}' is available (size=${size}, distance=${dist})`);
      } catch (_e) {
        // Ignore validation errors; collection exists
      }
    }
  } catch (e) {
    console.error('[qdrant] Initialization failed:', e);
  }
});


