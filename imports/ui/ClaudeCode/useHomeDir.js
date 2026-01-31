import { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

let cachedHome = null;

export const useHomeDir = () => {
  const [home, setHome] = useState(cachedHome);

  useEffect(() => {
    if (cachedHome) return;
    Meteor.call('system.getHomeDir', (err, result) => {
      if (!err && result) {
        cachedHome = result;
        setHome(result);
      }
    });
  }, []);

  return home;
};

export const shortenPath = (p, home) => {
  if (!p || !home) return p;
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
};
