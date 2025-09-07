import { Meteor } from 'meteor/meteor';

// Helper to create a new link with sensible defaults
// Usage: createNewLink(); or createNewLink(projectId);
export const createNewLink = (projectId, onInserted) => {
  const payload = { name: 'New Link', url: 'https://example.com' };
  if (projectId) payload.projectId = projectId;
  Meteor.call('links.insert', payload, (err, res) => {
    if (err) console.error('links.insert failed', err);
    if (!err && typeof onInserted === 'function') onInserted(res);
  });
};
