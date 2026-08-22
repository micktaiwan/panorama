import { Meteor } from 'meteor/meteor';
import { ErrorsCollection } from './collections';

// Only run on server
if (Meteor.isServer) {
  const originalError = console.error;

  // Wrapped errors keep the only useful detail out of `stack`: an undici `TypeError: fetch
  // failed` says nothing, while its `cause` carries ECONNREFUSED plus the address and port
  // that was unreachable. Flatten `cause` (and AggregateError.errors) so a persisted error
  // stays diagnosable long after the fact.
  const describeCause = (err) => {
    const head = [err?.name || 'Error', err?.message || String(err)].filter(Boolean).join(': ');
    const details = ['code', 'errno', 'syscall', 'address', 'port', 'hostname']
      .filter((key) => err?.[key] !== undefined && err?.[key] !== null)
      .map((key) => `${key}=${err[key]}`);
    return details.length > 0 ? `${head} (${details.join(' ')})` : head;
  };

  const collectCauses = (err, depth = 0) => {
    if (!err || depth > 5) return [];
    const nested = Array.isArray(err.errors) ? err.errors : [];
    const direct = err.cause ? [err.cause] : [];
    return [...direct, ...nested].flatMap((c) => [describeCause(c), ...collectCauses(c, depth + 1)]);
  };

  const stringifyArg = (arg) => {
    if (arg instanceof Error) {
      const base = arg.stack || arg.message || String(arg);
      const causes = collectCauses(arg);
      return causes.length > 0 ? `${base}\n${causes.map((c) => `caused by: ${c}`).join('\n')}` : base;
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
      const causes = collectCauses(firstErr);
      if (causes.length > 0) context.causes = causes;
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
