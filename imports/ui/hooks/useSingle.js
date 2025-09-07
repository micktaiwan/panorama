import { useFind } from 'meteor/react-meteor-data';

export const useSingle = (getCursor) => {
  const docs = useFind(getCursor);
  return docs[0];
};


