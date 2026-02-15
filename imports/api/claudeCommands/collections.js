import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const ClaudeCommandsCollection = new Mongo.Collection('claudeCommands', driverOptions);
