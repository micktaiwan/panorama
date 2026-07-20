// Entry point for Meteor server tests (meteor.testModule in package.json).
// Test files are not eagerly loaded under Rspack — import them explicitly.
import '/tests/chat_tools.test.js';
import '/imports/api/chat/__tests__/helpers.server.test.js';
import '/imports/api/tools/__tests__/handlers.server.test.js';
import '/imports/api/tools/__tests__/helpers.server.test.js';
import '/imports/api/tools/__tests__/editNote.server.test.js';
import '/imports/api/projects/__tests__/sharing.server.test.js';
