import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { notify } from '../utils/notify.js';

export const PrefsProfile = () => {
  const user = useTracker(() => Meteor.user(), []);
  const [name, setName] = React.useState('');

  React.useEffect(() => {
    if (user) setName(user.profile?.name || '');
  }, [user?._id, user?.profile?.name]);

  const email = user?.emails?.[0]?.address || '';

  return (
    <>
      <h3>Profile</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Display name</div>
          <div className="prefsValue">
            <InlineEditable
              value={name}
              placeholder="Enter your name"
              fullWidth
              onSubmit={(next) => {
                setName(next);
                Meteor.call('users.updateProfile', { name: next }, (err) => {
                  if (err) {
                    notify({ message: `Failed: ${err.reason || err.message}`, kind: 'error' });
                    return;
                  }
                  notify({ message: 'Name updated', kind: 'success' });
                });
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Email</div>
          <div className="prefsValue">
            <span className="muted">{email}</span>
          </div>
        </div>
      </div>
    </>
  );
};
