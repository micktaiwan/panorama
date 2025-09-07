import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { BudgetLinesCollection } from '/imports/api/budget/collections';

export const useBudgetData = (departmentFilter) => {
  const linesReady = useTracker(() => Meteor.subscribe('budget.lines.recent').ready(), []);

  const recentLines = useTracker(() => {
    let selector = {};
    if (departmentFilter === 'parked') selector = { department: 'parked' };
    else if (departmentFilter === 'techOnly') selector = { department: 'tech' };
    else if (departmentFilter === 'review') selector = { $or: [ { department: { $exists: false } }, { department: { $nin: ['tech', 'parked'] } } ] };
    return BudgetLinesCollection.find(selector, { sort: { date: -1, importedAt: -1 } }).fetch();
  }, [linesReady, departmentFilter]);

  const allLines = useTracker(() => {
    return BudgetLinesCollection.find({}, { sort: { date: -1, importedAt: -1 } }).fetch();
  }, [linesReady]);

  return { linesReady, recentLines, allLines };
};


