import { App } from '@slack/bolt';
import { getSlackConfig } from '/imports/api/_shared/config';
import { buildSaveModal, slackTsToDate, formatNoteContent } from './slackHelpers';

let slackApp = null;

export async function initSlackBot() {
  const config = getSlackConfig();
  if (!config.enabled || !config.botToken || !config.appToken) {
    console.log('[slack] Disabled or missing tokens');
    return;
  }

  slackApp = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  // --- Message Shortcut ---
  slackApp.shortcut('save_to_panorama', async ({ shortcut, ack, client }) => {
    await ack();

    if (config.allowedUserId && shortcut.user.id !== config.allowedUserId) return;

    const msg = shortcut.message;

    // Semantic search to suggest a project (after ack, no timeout risk)
    let suggestedProjectId = null;
    try {
      const { embedText, getQdrantClient, COLLECTION } = await import('/imports/api/search/vectorStore');
      const vector = await embedText(msg.text);
      if (vector) {
        const qClient = await getQdrantClient();
        const results = await qClient.search(COLLECTION(), {
          vector, limit: 3, with_payload: true,
        });
        const firstWithProject = results?.find(r => r.payload?.projectId);
        suggestedProjectId = firstWithProject?.payload?.projectId || null;
      }
    } catch (e) {
      console.error('[slack] Semantic search failed', e);
    }

    // Projects for the dropdown
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find(
      {}, { fields: { name: 1 }, sort: { name: 1 } }
    ).fetchAsync();

    // Resolve author name
    let userName = shortcut.user?.username || shortcut.user.id;
    try {
      const userInfo = await client.users.info({ user: msg.user });
      userName = userInfo.user?.real_name || userInfo.user?.name || userName;
    } catch (_) { /* keep fallback */ }

    // Resolve user mentions in message text (<@U123> → @RealName)
    const mentionIds = [...new Set((msg.text || '').match(/<@([A-Z0-9]+)>/g)?.map(m => m.slice(2, -1)) || [])];
    if (mentionIds.length) {
      const nameMap = {};
      await Promise.all(mentionIds.map(async (uid) => {
        try {
          const info = await client.users.info({ user: uid });
          nameMap[uid] = info.user?.real_name || info.user?.name || uid;
        } catch (_) { nameMap[uid] = uid; }
      }));
      msg.text = msg.text.replace(/<@([A-Z0-9]+)>/g, (_, uid) => `@${nameMap[uid] || uid}`);
    }

    // Permalink
    let permalink = '';
    try {
      const res = await client.chat.getPermalink({
        channel: shortcut.channel.id,
        message_ts: msg.ts,
      });
      permalink = res.permalink;
    } catch (_) { /* no permalink available */ }

    // Open the modal
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: buildSaveModal(
        {
          text: msg.text, user: userName, channelId: shortcut.channel.id,
          channelName: shortcut.channel.name, ts: msg.ts, permalink,
        },
        suggestedProjectId,
        projects
      ),
    });
  });

  // --- Modal Submit ---
  slackApp.view('save_to_panorama_submit', async ({ ack, view, body, client }) => {
    await ack();

    const projectId = view.state.values.project_block.project_select.selected_option.value;
    const meta = JSON.parse(view.private_metadata);

    const title = `[Slack] ${(meta.text || '').substring(0, 60).replace(/\n/g, ' ')}`;
    const content = formatNoteContent({
      text: meta.text,
      userName: meta.user,
      channelName: meta.channelName,
      date: slackTsToDate(meta.ts),
      permalink: meta.permalink,
    });

    // Create note directly (server-side, outside Meteor fibers)
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const noteId = await NotesCollection.insertAsync({
      title: title.trim(),
      content,
      projectId,
      source: 'slack',
      createdAt: new Date(),
    });

    // Index in Qdrant
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore');
      await upsertDocChunks({
        kind: 'note', id: noteId,
        text: `${title} ${content}`.trim(),
        projectId, minChars: 800, maxChars: 1200, overlap: 150,
      });
    } catch (e) {
      console.error('[slack] Qdrant index failed', e);
    }

    // Update the project's updatedAt
    await ProjectsCollection.updateAsync(projectId, { $set: { updatedAt: new Date() } });
  });

  await slackApp.start();
  console.log('[slack] Bot started (Socket Mode)');
}
