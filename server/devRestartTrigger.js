// Dev-only restart trigger — see wakeRecovery.js.
//
// In development, wake-recovery restarts the server by REWRITING this file
// with a fresh timestamp comment: the Meteor watcher sees the content hash
// change (a bare mtime touch is not enough — the watcher compares hashes),
// rebuilds, and relaunches the server process. A plain `process.exit` does NOT
// work under `meteor run`: the tool treats any exit — even code 0 — as a crash
// and waits for a file change instead of relaunching.
//
// This file is imported by wakeRecovery.js only so it is part of the server
// bundle and therefore part of the watch set. It intentionally exports nothing.
// A "last wake-recovery restart" comment appended below is normal.
