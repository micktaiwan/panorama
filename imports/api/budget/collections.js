import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const BudgetLinesCollection = new Mongo.Collection('budgetLines', driverOptions);
export const VendorsCacheCollection = new Mongo.Collection('vendorsCache', driverOptions);
export const VendorsIgnoreCollection = new Mongo.Collection('vendorsIgnore', driverOptions);

if (Meteor.isServer) {
  BudgetLinesCollection.rawCollection().createIndex({ date: 1, category: 1, vendor: 1 });
  BudgetLinesCollection.rawCollection().createIndex({ importBatch: 1 });
  BudgetLinesCollection.rawCollection().createIndex({ projectId: 1 });
  BudgetLinesCollection.rawCollection().createIndex({ dedupeHash: 1 }, { unique: false });
  BudgetLinesCollection.rawCollection().createIndex({ department: 1, date: -1 });
  VendorsCacheCollection.rawCollection().createIndex({ supplierId: 1 }, { unique: true });
  VendorsIgnoreCollection.rawCollection().createIndex({ supplierId: 1 }, { unique: false });
  VendorsIgnoreCollection.rawCollection().createIndex({ vendorNameLower: 1 }, { unique: false });
  VendorsIgnoreCollection.rawCollection().createIndex({ type: 1 }, { unique: false });
  VendorsIgnoreCollection.rawCollection().createIndex({ publicFileUrl: 1 }, { unique: false });
}
