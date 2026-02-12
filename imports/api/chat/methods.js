// Chat methods - with streaming and real-time tool feedback
// Uses Claude SDK with callbacks for live status updates

import { Meteor } from 'meteor/meteor';
import { ChatsCollection } from '/imports/api/chats/collections';
import { runChatAgent, isClaudeAgentAvailable } from './claudeAgent';
import { requireUserId } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'chat.ask'(payload) {
    const userId = requireUserId();
    const query = String(payload?.query || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];

    if (!query) {
      throw new Meteor.Error('bad-request', 'query is required');
    }

    // Check if Claude agent is available
    if (!isClaudeAgentAvailable()) {
      await ChatsCollection.insertAsync({
        userId,
        role: 'assistant',
        content: 'Clé API Anthropic non configurée. Ajoutez-la dans Préférences → Secrets → Anthropic API Key.',
        error: true,
        createdAt: new Date()
      });
      throw new Meteor.Error(
        'config-error',
        'Clé API Anthropic non configurée. Ajoutez-la dans les Préférences.'
      );
    }

    // Track current status message ID for updates
    let currentStatusId = null;

    // Insert initial status message
    currentStatusId = await ChatsCollection.insertAsync({
      userId,
      role: 'assistant',
      content: '🤔 Réflexion…',
      isStatus: true,
      createdAt: new Date()
    });

    try {
      // Run the Claude agent with callbacks for real-time feedback
      const { text, citations, actions } = await runChatAgent(query, history, {
        // Called when tool execution starts
        onToolStart: async (tools) => {
          const toolList = tools.map(t => `${t.displayName}${t.args}`).join(', ');
          const emoji = tools.length > 1 ? '🔧' : '🔍';
          const content = `${emoji} ${toolList}…`;

          // Update existing status message
          if (currentStatusId) {
            await ChatsCollection.updateAsync(currentStatusId, {
              $set: { content, updatedAt: new Date() }
            });
          }
        },

        // Called when tool execution ends
        onToolEnd: async (tools, results) => {
          // Check if any tool had an error
          const hasError = results.some(r => {
            try {
              const parsed = JSON.parse(r.content || '{}');
              return !!parsed.error;
            } catch {
              return false;
            }
          });

          const emoji = hasError ? '⚠️' : '✓';
          const toolList = tools.map(t => t.displayName).join(', ');
          const content = `${emoji} ${toolList} terminé`;

          // Insert completed status and create new one for next iteration
          if (currentStatusId) {
            await ChatsCollection.updateAsync(currentStatusId, {
              $set: { content, updatedAt: new Date() }
            });
          }

          // Create new status for potential next iteration
          currentStatusId = await ChatsCollection.insertAsync({
            userId,
            role: 'assistant',
            content: '🤔 Analyse des résultats…',
            isStatus: true,
            createdAt: new Date()
          });
        },

        // Called with text chunks during streaming (optional - for future use)
        onText: async (chunk) => {
          // Could be used to stream partial responses
          // For now, we wait for complete response
        }
      });

      // Remove the last "analyzing" status message
      if (currentStatusId) {
        await ChatsCollection.removeAsync(currentStatusId);
      }

      // Persist the final response
      const base = {
        userId,
        role: 'assistant',
        content: text,
        createdAt: new Date()
      };

      // Add citations if present
      if (citations.length > 0) {
        base.citations = citations;
      }

      // Add actions if present
      if (actions && actions.length > 0) {
        base.actions = actions;
      }

      await ChatsCollection.insertAsync(base);

      return { text, citations, actions: actions || [] };
    } catch (error) {
      console.error('[chat.ask] Agent error:', error);

      // Clean up status message
      if (currentStatusId) {
        await ChatsCollection.removeAsync(currentStatusId);
      }

      // Insert error message
      await ChatsCollection.insertAsync({
        userId,
        role: 'assistant',
        content: `Erreur: ${error.message || 'Erreur inconnue'}`,
        error: true,
        createdAt: new Date()
      });

      throw new Meteor.Error('agent-error', error.message || 'Chat agent failed');
    }
  }
});
