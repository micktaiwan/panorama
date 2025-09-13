import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { LinksCollection } from './collections';

const ensureHttpUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  // Add https:// if scheme is missing
  return /^(https?:)\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const normalize = (doc) => {
  const out = { ...doc };
  if (typeof out.name === 'string') out.name = out.name.trim();
  if (typeof out.url === 'string') out.url = ensureHttpUrl(out.url);
  return out;
};

Meteor.methods({
  async 'links.insert'(doc) {
    check(doc, {
      projectId: Match.Maybe(String),
      name: String,
      url: String,
    });
    const now = new Date();
    const clean = normalize(doc);
    const _id = await LinksCollection.insertAsync({
      ...clean,
      clicksCount: 0,
      lastClickedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    // Live search upsert
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      const text = `${clean.name || ''} ${clean.url || ''}`.trim();
      await upsertDoc({ kind: 'link', id: _id, text, projectId: clean.projectId || null });
    } catch (e) { console.error('[search][links.insert] upsert failed', e); }
    return _id;
  },
  async 'links.update'(linkId, modifier) {
    check(linkId, String);
    check(modifier, Object);
    const clean = normalize(modifier);
    const res = await LinksCollection.updateAsync(linkId, { $set: { ...clean, updatedAt: new Date() } });
    // Live search upsert
    try {
      const next = await LinksCollection.findOneAsync(linkId, { fields: { name: 1, url: 1, projectId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      const text = `${next?.name || ''} ${next?.url || ''}`.trim();
      await upsertDoc({ kind: 'link', id: linkId, text, projectId: next?.projectId || null });
    } catch (e) { console.error('[search][links.update] upsert failed', e); }
    return res;
  },
  async 'links.remove'(linkId) {
    check(linkId, String);
    const res = await LinksCollection.removeAsync(linkId);
    try {
      const { deleteDoc } = await import('/imports/api/search/vectorStore.js');
      await deleteDoc('link', linkId);
    } catch (e) { console.error('[search][links.remove] delete failed', e); }
    return res;
  },
  async 'links.registerClick'(linkId) {
    check(linkId, String);
    return LinksCollection.updateAsync(linkId, { $inc: { clicksCount: 1 }, $set: { lastClickedAt: new Date(), updatedAt: new Date() } });
  },
  async 'links.getUrl'(linkId, opts = {}) {
    check(linkId, String);
    const registerClick = !!(opts && opts.registerClick);
    const l = await LinksCollection.findOneAsync({ _id: linkId }, { fields: { url: 1 } });
    if (!l || !l.url) throw new Meteor.Error('not-found', 'Link not found');
    const url = ensureHttpUrl(l.url);
    if (registerClick) {
      await LinksCollection.updateAsync(linkId, { $inc: { clicksCount: 1 }, $set: { lastClickedAt: new Date(), updatedAt: new Date() } });
    }
    return url;
  }
});


