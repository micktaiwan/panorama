import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { UserPresenceCollection } from '/imports/api/userPresence/collections';
import './PresenceBar.css';

const STATUS_ORDER = { online: 0, away: 1, offline: 2 };

export const PresenceBar = () => {
  const subPresence = useSubscribe('userPresence.network');
  const subUsers = useSubscribe('users.network');

  const presenceDocs = useFind(() => UserPresenceCollection.find({}));
  const networkUsers = useTracker(() => {
    const userIds = presenceDocs.map((d) => d.userId);
    if (userIds.length === 0) return [];
    return Meteor.users.find({ _id: { $in: userIds } }).fetch();
  }, [presenceDocs]);

  if (subPresence() || subUsers()) return null; // loading
  if (presenceDocs.length <= 1) return null;

  const currentUserId = Meteor.userId();

  // Merge presence with user info, sorted: self first, then by status
  const items = presenceDocs
    .map((doc) => {
      const user = networkUsers.find((u) => u._id === doc.userId);
      const isSelf = doc.userId === currentUserId;
      const name = user?.profile?.name || user?.username || user?.emails?.[0]?.address || 'Unknown';
      return { ...doc, name: isSelf ? `${name} (you)` : name, isSelf };
    })
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
    });

  return (
    <span className="presenceBar">
      {items.map((item) => (
        <span key={item.userId} className={`presenceItem presence-${item.status || 'offline'}`}>
          <span className="presenceDot" />
          <span className="presenceName">{item.name}</span>
        </span>
      ))}
    </span>
  );
};
