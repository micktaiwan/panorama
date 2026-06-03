import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { OpportunitiesCollection, OPPORTUNITY_STATUSES } from './collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const cleanStatus = (s) => (OPPORTUNITY_STATUSES.includes(s) ? s : 'in_progress');

// Keywords: accept an array or a comma/newline-separated string -> normalized, deduped list.
const cleanKeywords = (kw) => {
  const raw = Array.isArray(kw) ? kw : String(kw || '').split(/[,\n]/);
  const seen = new Set();
  const out = [];
  for (const k of raw) {
    const v = String(k || '').trim().toLowerCase();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out.slice(0, 40);
};

Meteor.methods({
  async 'opportunities.insert'(fields) {
    ensureLoggedIn(this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const name = String(fields.name || '').trim();
    if (!name) throw new Meteor.Error('invalid-arg', 'name is required');
    const now = new Date();
    // New opportunity goes to the end of the column order.
    const last = await OpportunitiesCollection.findOneAsync(
      { userId: this.userId },
      { sort: { order: -1 }, fields: { order: 1 } }
    );
    const order = (last?.order ?? -1) + 1;
    const doc = {
      name,
      status: cleanStatus(fields.status),
      cycle: typeof fields.cycle === 'string' ? fields.cycle.trim() : '',
      notionUrl: typeof fields.notionUrl === 'string' ? fields.notionUrl.trim() : '',
      keywords: cleanKeywords(fields.keywords),
      order,
      userId: this.userId,
      createdAt: now,
      updatedAt: now
    };
    return await OpportunitiesCollection.insertAsync(doc);
  },

  async 'opportunities.update'(id, fields) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(OpportunitiesCollection, id, this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('name' in fields) {
      const name = String(fields.name || '').trim();
      if (!name) throw new Meteor.Error('invalid-arg', 'name cannot be empty');
      updates.name = name;
    }
    if ('status' in fields) updates.status = cleanStatus(fields.status);
    if ('cycle' in fields) updates.cycle = typeof fields.cycle === 'string' ? fields.cycle.trim() : '';
    if ('notionUrl' in fields) updates.notionUrl = typeof fields.notionUrl === 'string' ? fields.notionUrl.trim() : '';
    if ('keywords' in fields) updates.keywords = cleanKeywords(fields.keywords);
    if ('order' in fields && Number.isFinite(Number(fields.order))) updates.order = Number(fields.order);
    updates.updatedAt = new Date();
    await OpportunitiesCollection.updateAsync({ _id: id }, { $set: updates });
  },

  async 'opportunities.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(OpportunitiesCollection, id, this.userId);
    await OpportunitiesCollection.removeAsync({ _id: id });
    // Cascade: drop staffing rows tied to this opportunity.
    const { StaffingCollection } = await import('/imports/api/staffing/collections');
    await StaffingCollection.removeAsync({ userId: this.userId, opportunityId: id });
  }
});
