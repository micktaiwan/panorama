// Shared prompt helpers and JSON schemas for Situation Analyzer LLM calls

export const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export const buildKnownPeopleCatalog = (people) => {
  const list = Array.isArray(people) ? people : [];
  return list.slice(0, 200).map((p) => {
    const full = [p.name || '', p.lastName || ''].filter(Boolean).join(' ').trim() || (p.name || '');
    const role = p.role ? ` — role: ${toOneLine(p.role)}` : '';
    const aliases = Array.isArray(p.aliases) && p.aliases.length > 0 ? ` (aliases: ${p.aliases.map(toOneLine).join(', ')})` : '';
    return `- ${p._id} — ${full}${role}${aliases}`;
  });
};

export const buildRosterForQuestions = (actors) => {
  const list = Array.isArray(actors) ? actors : [];
  return list
    .filter((a) => a.personId)
    .map(
      (a) => `- ${a.personId} — ${a.name || ''}${a.situationRole ? ` — situationRole: ${toOneLine(a.situationRole)}` : ''}${a.role ? ` — companyRole: ${toOneLine(a.role)}` : ''}`
    );
};

export const buildRosterForSummary = (actors) => {
  const list = Array.isArray(actors) ? actors : [];
  return list
    .filter((a) => a.personId)
    .map((a) => `- ${a.personId} — ${a.name || ''}${a.role ? ` — role: ${toOneLine(a.role)}` : ''}`);
};

export const buildPriorBlock = (actors, actorIdToPrior) => {
  const list = Array.isArray(actors) ? actors : [];
  const blocks = [];
  for (const a of list) {
    const qs = actorIdToPrior.get(String(a._id)) || [];
    if (!qs.length) continue;
    const header = `Actor: ${a.personId ? a.personId : (a.name || '')}${a.situationRole ? ` — situationRole: ${a.situationRole}` : ''}`;
    const lines = qs.map((q) => `Q: ${q.q || ''}${q.r && q.r.trim() ? ` | R: ${q.r.trim()}` : ''}`);
    blocks.push([header, ...lines].join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '(none)';
};

export const buildNotesByActorBlock = (actors, actorIdToNotes, generalNotes) => {
  const list = Array.isArray(actors) ? actors : [];
  const blocks = [];
  for (const a of list) {
    const ns = actorIdToNotes.get(String(a._id)) || [];
    if (!ns.length) continue;
    const header = `Notes — ${a.personId ? a.personId : ''} — ${a.name || ''}${a.situationRole ? ` — situationRole: ${a.situationRole}` : ''}`.trim();
    blocks.push([header, ...ns.map((t) => `- ${t}`)].join('\n'));
  }
  if ((generalNotes || []).length > 0) blocks.push(['Notes — General', ...generalNotes.map((t) => `- ${t}`)].join('\n'));
  return blocks.length > 0 ? blocks.join('\n\n') : '(none)';
};

// JSON Schemas
export const extractActorsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          personId: { type: 'string', description: 'The personId of the actor' },
          name: { type: 'string', description: 'The name of the actor' },
          situationRole: { type: 'string', description: "Short description of the actor's role in this situation" }
        },
        required: ['personId', 'name', 'situationRole']
      }
    }
  },
  required: ['actors']
};

export const generateQuestionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          personId: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { q: { type: 'string' }, r: { type: 'string' } },
              required: ['q', 'r']
            }
          }
        },
        required: ['personId', 'questions']
      }
    }
  },
  required: ['items']
};

// Standardized logging helper for OpenAI payloads
export const logOpenAiPayload = (name, system, user) => {
  console.log(`[situations.${name}] System:`, system);
  console.log(`[situations.${name}] User:`, user);
};
