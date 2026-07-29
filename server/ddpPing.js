import { Meteor } from 'meteor/meteor';

Meteor.methods({
  // Liveness probe for the client's zombie-connection detector (see
  // imports/ui/ddpKeepAlive.js). Deliberately does nothing but return: a fast
  // round-trip proves the DDP socket is really alive, not just reported
  // "connected" over a socket that died during sleep.
  'ddp.ping'() {
    return true;
  },
});
