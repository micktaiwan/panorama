import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const SituationActorsCollection = new Mongo.Collection('situation_actors');


if (Meteor.isServer) {
  SituationActorsCollection.rawCollection().createIndex(
    { situationId: 1, personId: 1 },
    { unique: true, sparse: true, name: 'uniq_situationId_personId' }
  );
}
