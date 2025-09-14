import { Meteor } from 'meteor/meteor';
import { getQdrantUrl } from '/imports/api/_shared/config';

// Initialize Qdrant collection on server start (if configured)
Meteor.startup(async () => {
  const url = getQdrantUrl();
  if (!url) {
    console.error('[qdrant] Disabled (no URL configured); skipping initialization');
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
        console.error('[qdrant] Health check failed or non-OK response');
      }
    } catch (e) {
      console.error('[qdrant] Health check threw an error:', e);
    }

    // Ensure collection exists with expected vector parameters
    let exists = false;
    try {
      const info = await client.getCollection(collectionName);
      exists = !!info;
    } catch (e) {
      console.error(`[qdrant] getCollection('${collectionName}') failed (will attempt create):`, e?.message ?? e);
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
        const cfg = info?.config?.params?.vectors;
        const size = cfg?.size || cfg?.config?.size;
        const dist = cfg?.distance || cfg?.config?.distance;
        if (Number(size) !== vectorSize || String(dist).toLowerCase() !== String(distance).toLowerCase()) {
          console.error(`[qdrant] Collection '${collectionName}' exists but vector config differs (have size=${size}, distance=${dist}; expected size=${vectorSize}, distance=${distance})`);
        }
        // Removed success-level availability log
      } catch (_e) {
        // Ignore validation errors; collection exists
      }
    }
  } catch (e) {
    console.error('[qdrant] Initialization failed:', e);
  }
});


