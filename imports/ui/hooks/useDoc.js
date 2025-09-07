import { useTracker } from 'meteor/react-meteor-data';

export const useDoc = (getDoc) => {
  return useTracker(getDoc);
};


