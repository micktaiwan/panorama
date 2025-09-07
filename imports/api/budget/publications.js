import { Meteor } from 'meteor/meteor';
import { BudgetLinesCollection } from './collections';

Meteor.publish('budget.lines.recent', function () {
  return BudgetLinesCollection.find({}, { sort: { importedAt: -1 } });
});

Meteor.publish('budget.lines.byProject', function (projectId) {
  check(projectId, String);
  if (!projectId) return this.ready();
  return BudgetLinesCollection.find({ projectId }, { sort: { date: -1 } });
});
