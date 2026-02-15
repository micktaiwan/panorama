import { MongoInternals } from 'meteor/mongo';

const localUrl = process.env.LOCAL_MONGO_URL;

export const localDriver = localUrl
  ? new MongoInternals.RemoteCollectionDriver(localUrl)
  : null; // Si pas de LOCAL_MONGO_URL, tout utilise le driver par defaut (dev, tests, VPS)
