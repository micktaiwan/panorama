import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { PeopleCollection } from './collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const normalize = (s) => {
  const base = String(s || '').trim();
  try { return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); } catch (_e) { return base.toLowerCase(); }
};

Meteor.methods({
  async 'people.insert'(fields) {
    ensureLoggedIn(this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const name = String(fields.name || '').trim();
    if (!name) throw new Meteor.Error('invalid-arg', 'name is required');
    const aliases = Array.isArray(fields.aliases) ? fields.aliases.map(a => String(a || '').trim()).filter(Boolean) : [];
    const notes = typeof fields.notes === 'string' ? fields.notes : '';
    const role = typeof fields.role === 'string' ? fields.role.trim() : '';
    const email = typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
    const lastName = typeof fields.lastName === 'string' ? fields.lastName.trim() : '';
    const now = new Date();
    const normalizedName = normalize(name);
    const left = !!fields.left;
    const contactOnly = !!fields.contactOnly;
    const subteam = typeof fields.subteam === 'string' ? fields.subteam.trim() : '';
    const teamId = fields.teamId ? String(fields.teamId) : undefined;
    const arrivalDate = fields.arrivalDate ? new Date(fields.arrivalDate) : undefined;
    const doc = { name, lastName, normalizedName, aliases, role, email, notes, left, contactOnly, userId: this.userId, createdAt: now, updatedAt: now };
    if (teamId) doc.teamId = teamId;
    if (subteam) doc.subteam = subteam;
    if (arrivalDate && !isNaN(arrivalDate.getTime())) doc.arrivalDate = arrivalDate;
    const _id = await PeopleCollection.insertAsync(doc);
    return _id;
  },
  async 'people.update'(id, fields) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(PeopleCollection, id, this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    const unset = {};
    if ('name' in fields) {
      const name = String(fields.name || '').trim();
      updates.name = name;
      updates.normalizedName = normalize(name);
    }
    if ('aliases' in fields) updates.aliases = Array.isArray(fields.aliases) ? fields.aliases.map(a => String(a || '').trim()).filter(Boolean) : [];
    if ('notes' in fields) updates.notes = typeof fields.notes === 'string' ? fields.notes : '';
    if ('role' in fields) updates.role = typeof fields.role === 'string' ? fields.role.trim() : '';
    if ('email' in fields) updates.email = typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
    if ('lastName' in fields) updates.lastName = typeof fields.lastName === 'string' ? fields.lastName.trim() : '';
    if ('left' in fields) updates.left = !!fields.left;
    if ('contactOnly' in fields) updates.contactOnly = !!fields.contactOnly;
    if ('teamId' in fields) {
      if (fields.teamId) updates.teamId = String(fields.teamId);
      else unset.teamId = 1;
    }
    if ('subteam' in fields) {
      const st = typeof fields.subteam === 'string' ? fields.subteam.trim() : '';
      if (st) updates.subteam = st; else unset.subteam = 1;
    }
    if ('arrivalDate' in fields) {
      const d = fields.arrivalDate ? new Date(fields.arrivalDate) : null;
      if (d && !isNaN(d.getTime())) updates.arrivalDate = d; else unset.arrivalDate = 1;
    }
    updates.updatedAt = new Date();
    const modifier = { $set: updates };
    if (Object.keys(unset).length > 0) modifier.$unset = unset;
    await PeopleCollection.updateAsync({ _id: id }, modifier);
  },
  async 'people.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(PeopleCollection, id, this.userId);
    await PeopleCollection.removeAsync({ _id: id });
  }
});

// Import people from a Google Workspace JSON export
// Deduplicate by email (primary) or last name lowercased (fallback)
Meteor.methods({
  async 'people.importGoogleWorkspace'(records) {
    check(records, Array);
    ensureLoggedIn(this.userId);
    const now = new Date();

    // Count total before import
    const totalBefore = await PeopleCollection.find({ userId: this.userId }).countAsync();

    // Build lookup maps from existing people
    const cursor = PeopleCollection.find({ userId: this.userId }, { fields: { _id: 1, email: 1, name: 1, lastName: 1, left: 1 } });
    const existingPeople = typeof cursor.fetchAsync === 'function' ? await cursor.fetchAsync() : cursor.fetch();
    const emailToPerson = new Map();
    const lastLowerToPerson = new Map();
    existingPeople.forEach(p => {
      const email = String(p.email || '').trim().toLowerCase();
      if (email && !emailToPerson.has(email)) emailToPerson.set(email, p);
      const lastLower = String(p.lastName || '').trim().toLowerCase();
      if (lastLower && !lastLowerToPerson.has(lastLower)) lastLowerToPerson.set(lastLower, p);
    });

    // Deduplicate inside the incoming dataset as well
    const seenEmails = new Set();
    const seenLastLowers = new Set();

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const getField = (obj, key) => String((obj && obj[key]) || '').trim();

    for (const rec of records) {
      if (!rec || typeof rec !== 'object') { skipped++; continue; }

      const firstName = getField(rec, 'First Name [Required]');
      const lastName = getField(rec, 'Last Name [Required]');
      const email = getField(rec, 'Email Address [Required]').toLowerCase();
      const status = getField(rec, 'Status [READ ONLY]');
      const isActive = status.toLowerCase() === 'active';
      const left = !isActive; // active corresponds to left=false

      // Skip empty rows
      if (!firstName && !lastName && !email) { skipped++; continue; }

      const lastLower = lastName.toLowerCase();

      // Intra-file dedupe
      if (email) {
        if (seenEmails.has(email)) { skipped++; continue; }
        seenEmails.add(email);
      } else if (lastLower) {
        if (seenLastLowers.has(lastLower)) { skipped++; continue; }
        seenLastLowers.add(lastLower);
      }

      // Find existing
      let existing = null;
      if (email && emailToPerson.has(email)) existing = emailToPerson.get(email);
      if (!existing && lastLower && lastLowerToPerson.has(lastLower)) existing = lastLowerToPerson.get(lastLower);

      if (existing) {
        const updates = {};
        if (firstName) updates.name = firstName;
        if (lastName) updates.lastName = lastName;
        if (email) updates.email = email;
        updates.left = !!left;
        updates.updatedAt = now;
        if (updates.name) updates.normalizedName = normalize(updates.name);
        await PeopleCollection.updateAsync({ _id: existing._id }, { $set: updates });
        updated++;
      } else {
        const name = firstName || (lastName ? '' : '');
        if (!name && !email && !lastName) { skipped++; continue; }
        const doc = {
          name: name || firstName,
          lastName,
          normalizedName: normalize(name || firstName || ''),
          aliases: [],
          role: '',
          email,
          notes: '',
          left: !!left,
          userId: this.userId,
          createdAt: now,
          updatedAt: now
        };
        const _id = await PeopleCollection.insertAsync(doc);
        // Update maps to avoid duplicate subsequent inserts within this run
        if (email) emailToPerson.set(email, { _id, email, lastName });
        if (lastLower) lastLowerToPerson.set(lastLower, { _id, email, lastName });
        inserted++;
      }
    }

    // Count total after import
    const totalAfter = await PeopleCollection.find({ userId: this.userId }).countAsync();

    return { inserted, updated, skipped, totalBefore, totalAfter };
  }
});


