/**
 * Slack helpers for building modals and formatting note content.
 */

/** Convert a Slack timestamp ("1706712720.123456") to a Date */
export const slackTsToDate = (ts) => {
  const seconds = parseFloat(ts);
  if (!seconds || isNaN(seconds)) return new Date();
  return new Date(seconds * 1000);
};

/** Basic mrkdwn → markdown conversions */
export const convertMrkdwn = (text) => {
  if (!text) return '';
  return text
    .replace(/<@([A-Z0-9]+)>/g, '@$1')           // <@U123> → @U123
    .replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)')  // <url|label> → [label](url)
    .replace(/<([^>]+)>/g, '$1');                  // <url> → url
};

/** Format note content from Slack message metadata */
export const formatNoteContent = ({ text, userName, channelName, date, permalink }) => {
  const dateStr = date instanceof Date ? date.toISOString().slice(0, 16).replace('T', ' ') : String(date || '');
  const header = `**De** : ${userName || 'unknown'} · **Channel** : #${channelName || 'unknown'} · **Date** : ${dateStr}`;
  const link = permalink ? `[Voir sur Slack](${permalink})` : '';
  const body = convertMrkdwn(text);
  return [header, link, '', `> ${body.replace(/\n/g, '\n> ')}`].filter(Boolean).join('\n');
};

/** Build a Slack Block Kit modal for the "Save to Panorama" shortcut */
export const buildSaveModal = (message, suggestedProjectId, projects) => {
  const previewText = (message.text || '').substring(0, 200).replace(/\n/g, ' ');
  const dateStr = slackTsToDate(message.ts).toISOString().slice(0, 16).replace('T', ' ');

  const projectOptions = projects.map(p => ({
    text: { type: 'plain_text', text: p.name },
    value: p._id,
  }));

  const projectBlock = {
    type: 'input',
    block_id: 'project_block',
    label: { type: 'plain_text', text: 'Project' },
    element: {
      type: 'static_select',
      action_id: 'project_select',
      placeholder: { type: 'plain_text', text: 'Select a project' },
      options: projectOptions,
    },
  };

  // Set initial option if we have a suggestion and it exists in the list
  if (suggestedProjectId) {
    const match = projectOptions.find(o => o.value === suggestedProjectId);
    if (match) {
      projectBlock.element.initial_option = match;
    }
  }

  return {
    type: 'modal',
    callback_id: 'save_to_panorama_submit',
    title: { type: 'plain_text', text: 'Save to Panorama' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({
      text: message.text,
      user: message.user,
      channelId: message.channelId,
      channelName: message.channelName,
      ts: message.ts,
      permalink: message.permalink,
    }),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*From* ${message.user} in #${message.channelName || '?'} — ${dateStr}\n\n> ${previewText}`,
        },
      },
      projectBlock,
    ],
  };
};
