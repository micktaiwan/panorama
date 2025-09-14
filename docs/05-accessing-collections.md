# Accessing Mongo Collections (quick)

In‑app:

- Use read‑only `chat_collectionQuery` (allowlisted fields).
- Enable by updating `FIELD_ALLOWLIST`, `getListKeyForCollection`, and adding a branch in `chat_collectionQuery`.

Example:

```json
{"name":"chat_collectionQuery","arguments":{"collection":"userLogs","select":["content","createdAt"],"where":{"createdAt":{"gte":"2025-09-01T00:00:00.000Z"}},"limit":20}}
```

From this chat (local dev):

- Prereqs: app at `mongodb://127.0.0.1:3001/meteor`; `npm i mongodb`.

```bash
node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient('mongodb://127.0.0.1:3001/meteor');await c.connect();const d=await c.db('meteor').collection('userLogs').find({}).sort({createdAt:-1}).limit(5).toArray();console.log(JSON.stringify(d,null,2));await c.close();})();"
```

Note: This chat can’t call Meteor methods directly; it needs a DB URL or an app endpoint.
