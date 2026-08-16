import { Meteor } from 'meteor/meteor';
import { DDP } from 'meteor/ddp-client';

// Call a Meteor method with an explicit userId, outside any DDP session
// (MCP server-to-server calls, background jobs). The invocation mimics
// DDPCommon.MethodInvocation: there is no DDP session here, so unblock() is a
// no-op and setUserId() only mutates the local invocation.
//
// The invocation is published on DDP._CurrentMethodInvocation so that nested
// Meteor.callAsync() calls made by the method inherit the same userId; without
// it, the inner method runs unauthenticated and ensureLoggedIn() throws.
export const callMethodAs = async (methodName, userId, ...args) => {
  const handler = Meteor.server.method_handlers[methodName];
  if (!handler) throw new Meteor.Error('method-not-found', `Method ${methodName} not found`);
  const invocation = {
    userId,
    isSimulation: false,
    connection: null,
    unblock: () => {},
    setUserId: (id) => { invocation.userId = id; }
  };
  return DDP._CurrentMethodInvocation.withValue(invocation, () => handler.call(invocation, ...args));
};
