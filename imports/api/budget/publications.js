import { Meteor } from 'meteor/meteor';
import { BudgetLinesCollection, VendorsIgnoreCollection } from './collections';
import { check } from 'meteor/check';

Meteor.publish('budget.lines.recent', function () {
  if (!this.userId) return this.ready();
  return BudgetLinesCollection.find({ userId: this.userId }, { sort: { importedAt: -1 } });
});

Meteor.publish('budget.lines.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  check(projectId, String);
  if (!projectId) return this.ready();
  return BudgetLinesCollection.find({ projectId, userId: this.userId }, { sort: { date: -1 } });
});

Meteor.publish('budget.vendorsIgnore', function () {
  if (!this.userId) return this.ready();
  return VendorsIgnoreCollection.find({ userId: this.userId });
});
