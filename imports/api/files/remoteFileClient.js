// Remote file storage client — used by the local instance to delegate
// file operations (store, download, delete) to the VPS via HTTP.

const getConfig = () => ({
  url: process.env.PANORAMA_FILES_URL,
  apiKey: process.env.PANORAMA_FILES_API_KEY,
});

export const isRemoteFileStorage = () => {
  const { url, apiKey } = getConfig();
  return !!(url && apiKey);
};

const headers = () => ({
  'X-API-Key': getConfig().apiKey,
});

export const remoteStoreFile = async (storedFileName, contentBase64) => {
  const { url } = getConfig();
  const res = await fetch(`${url}/api/files/store`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ storedFileName, contentBase64 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Remote store failed (${res.status}): ${text}`);
  }
};

export const remoteGetFileStream = async (storedFileName) => {
  const { url } = getConfig();
  const res = await fetch(`${url}/api/files/raw/${encodeURIComponent(storedFileName)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Remote get failed (${res.status}): ${text}`);
  }
  return {
    body: res.body,
    size: res.headers.get('content-length'),
    contentType: res.headers.get('content-type'),
  };
};

export const remoteDeleteFile = async (storedFileName) => {
  const { url } = getConfig();
  const res = await fetch(`${url}/api/files/delete`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ storedFileName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Remote delete failed (${res.status}): ${text}`);
  }
};
