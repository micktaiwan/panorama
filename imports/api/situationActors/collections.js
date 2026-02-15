import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const SituationActorsCollection = new Mongo.Collection('situation_actors', driverOptions);


if (Meteor.isServer) {
  SituationActorsCollection.rawCollection().createIndex(
    { situationId: 1, personId: 1 },
    { unique: true, sparse: true, name: 'uniq_situationId_personId' }
  );
}
