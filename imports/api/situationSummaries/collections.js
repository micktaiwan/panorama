import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const SituationSummariesCollection = new Mongo.Collection('situation_summaries', driverOptions);


