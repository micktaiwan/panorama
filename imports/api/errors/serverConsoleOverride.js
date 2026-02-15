import { Meteor } from 'meteor/meteor';
import { ErrorsCollection } from './collections';

// Only run on server
if (Meteor.isServer) {
  const originalError = console.error;  

  const stringifyArg = (arg) => {
    if (arg instanceof Error) {
      return arg.stack || arg.message || String(arg);
    }
    if (typeof arg === 'string') {
      return arg;
    }
    return JSON.stringify(arg, null, 2);
  };

  console.error = function panoramaConsoleErrorOverride(...args) {  
    const parts = Array.isArray(args) ? args.map((a) => stringifyArg(a)) : [];
    const message = parts.length > 0 ? parts.join(' ') : 'Unknown server error';

    const context = {};
    const firstErr = Array.isArray(args) ? args.find((a) => a instanceof Error) : null;
    if (firstErr) {
      context.name = firstErr.name;
      context.stack = firstErr.stack || null;
    }

    ErrorsCollection
      .insertAsync({ kind: 'server', message: String(message).slice(0, 2000), context, userId: null, createdAt: new Date() })
      .catch((persistErr) => {
        // Report persistence failure through the original console to avoid recursion
        originalError('[consoleOverride] error persistence failed:', persistErr);
      });

    // Forward to original console
    originalError.apply(console, args);
  };
}


