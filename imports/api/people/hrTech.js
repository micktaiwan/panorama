import { Meteor } from 'meteor/meteor';
import { PeopleCollection } from './collections';

// Departures, read from HR Tech (the offboarding app), which is the only system
// that reads Lucca. Panorama used to learn about a departure whenever someone
// remembered to tick the box — that is exactly how an account stayed open for
// weeks after its owner had gone.
//
// It pulls what the SIRH is authoritative about and nothing else: who works
// here, since when, and until when. Roles, teams, notes and every person
// Panorama tracks who is not a lempire employee stay untouched. A one-way read:
// nothing is ever written back to HR Tech.
//
// This replaces the Google Workspace CSV import, and not only because it needs
// no human to download a file. Google says whether an account is active, which
// is a different question from whether someone works here — a mailbox left open
// for eighteen days after a departure was the incident that started all this.

const normalize = (s) => {
  const base = String(s || '').trim();
  try { return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); } catch (_e) { return base.toLowerCase(); }
};

const fullName = (p) => [p.name, p.lastName].filter(Boolean).join(' ').trim();

export async function fetchHrRoster() {
  const config = Meteor.settings?.hrTech;
  if (!config?.baseUrl || !config?.token) {
    throw new Meteor.Error('hr-not-configured', 'Add hrTech.baseUrl and hrTech.token to settings.json');
  }

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/roster`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) {
    // 401 here almost always means the token drifted between the two configs,
    // so say which door was closed rather than just the number.
    const detail = res.status === 401 ? 'token rejected' : await res.text().catch(() => '');
    throw new Meteor.Error('hr-unreachable', `HR Tech answered ${res.status} ${detail}`.trim());
  }
  const body = await res.json();
  return Array.isArray(body?.people) ? body.people : [];
}

// Match a roster entry to a Panorama person: the id HR kept from its own import
// first, then the email, then the full name. The name is a last resort and only
// against someone with no email, since a differing email means another human.
export function matchPerson(entry, byId, byEmail, byName) {
  if (entry.panoramaId && byId.has(entry.panoramaId)) return byId.get(entry.panoramaId);
  const email = normalize(entry.email);
  if (email && byEmail.has(email)) return byEmail.get(email);
  const candidate = byName.get(normalize(entry.name));
  if (candidate && !String(candidate.email || '').trim()) return candidate;
  return null;
}

export async function applyHrRoster(userId, { dryRun = false } = {}) {
  const roster = await fetchHrRoster();

  // Every field compared below has to be projected here, or the diff reads
  // undefined and proposes the same change on every run.
  const cursor = PeopleCollection.find({ userId }, { fields: { _id: 1, name: 1, lastName: 1, email: 1, left: 1, notes: 1, arrivalDate: 1 } });
  const people = typeof cursor.fetchAsync === 'function' ? await cursor.fetchAsync() : cursor.fetch();

  const byId = new Map(people.map(p => [p._id, p]));
  const byEmail = new Map();
  const byName = new Map();
  for (const p of people) {
    const email = normalize(p.email);
    if (email && !byEmail.has(email)) byEmail.set(email, p);
    const key = normalize(fullName(p));
    if (key && !byName.has(key)) byName.set(key, p);
  }

  const marked = [];
  const arrivals = [];
  const created = [];
  const conflicts = [];

  for (const entry of roster) {
    const person = matchPerson(entry, byId, byEmail, byName);

    if (!person) {
      // Only create people the SIRH vouches for. A row HR never matched to
      // Lucca says nothing about whether this person works here, and inventing
      // them in Panorama would be worse than missing them.
      if (entry.luccaId && entry.name) {
        created.push({ name: entry.name, email: entry.email || null, arrivalDate: entry.startDate || null, left: entry.status === 'left' });
      }
      continue;
    }

    const gone = entry.status === 'left';
    if (gone && !person.left) {
      marked.push({ personId: person._id, name: fullName(person), leftAt: entry.leftAt || null });
    } else if (!gone && person.left && entry.luccaId) {
      // Panorama says gone, the SIRH says employed. Never resolved silently:
      // one of the two is wrong and only a human knows which.
      conflicts.push({ personId: person._id, name: fullName(person), email: person.email || null, kind: 'status' });
    }

    // Arrival dates: fill the blanks, never overwrite. A date already in
    // Panorama that disagrees with the SIRH is a disagreement to show, not a
    // field to silently correct.
    if (entry.startDate) {
      const current = person.arrivalDate ? new Date(person.arrivalDate).toISOString().slice(0, 10) : null;
      if (!current) {
        arrivals.push({ personId: person._id, name: fullName(person), arrivalDate: entry.startDate });
      } else if (current !== entry.startDate) {
        conflicts.push({ personId: person._id, name: fullName(person), email: person.email || null, kind: 'arrival', here: current, sirh: entry.startDate });
      }
    }
  }

  if (!dryRun) {
    const now = new Date();

    for (const m of marked) {
      const person = byId.get(m.personId);
      const note = m.leftAt ? `Left on ${m.leftAt} (from Lucca, via HR Tech).` : 'Left (from HR Tech).';
      const existingNotes = String(person?.notes || '');
      // Append rather than replace: these notes are handwritten and a sync has
      // no business overwriting them.
      const notes = existingNotes.includes(note) ? existingNotes : [existingNotes, note].filter(Boolean).join('\n');
      await PeopleCollection.updateAsync({ _id: m.personId }, { $set: { left: true, notes, updatedAt: now } });
    }

    for (const a of arrivals) {
      await PeopleCollection.updateAsync({ _id: a.personId }, { $set: { arrivalDate: new Date(a.arrivalDate), updatedAt: now } });
    }

    for (const c of created) {
      const { first, last } = splitName(c.name);
      await PeopleCollection.insertAsync({
        name: first,
        lastName: last,
        normalizedName: normalize(first),
        aliases: [],
        role: '',
        email: String(c.email || '').toLowerCase(),
        notes: 'Created from the HR roster (Lucca, via HR Tech).',
        left: !!c.left,
        contactOnly: false,
        userId,
        ...(c.arrivalDate ? { arrivalDate: new Date(c.arrivalDate) } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { checked: roster.length, marked, arrivals, created, conflicts, dryRun };
}

// Panorama keeps the first name apart from the rest; the roster carries one
// string. Everything after the first word is the last name — wrong for a few
// compound first names, and visible on screen when it is.
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}
