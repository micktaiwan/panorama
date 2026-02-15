import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const SituationQuestionsCollection = new Mongo.Collection('situation_questions', driverOptions);


