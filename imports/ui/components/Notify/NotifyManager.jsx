import React from 'react';
import PropTypes from 'prop-types';
import { Notify } from './Notify.jsx';
import { setNotifyHandler } from '/imports/ui/utils/notify.js';
import './Notify.css';

// Global notify context to enqueue messages from anywhere
const NotifyContext = React.createContext({ enqueue: () => {} });

export const useNotify = () => React.useContext(NotifyContext);

export const NotifyProvider = ({ children, max = 4, defaultDurationMs = 3000 }) => {
  const [items, setItems] = React.useState([]); // [{ id, message, kind, durationMs }]

  const enqueue = React.useCallback((payload) => {
    const id = Math.random().toString(36).slice(2);
    const { message, kind = 'info', durationMs } = payload || {};
    setItems(prev => {
      const next = [...prev, { id, message, kind, durationMs: typeof durationMs === 'number' ? durationMs : defaultDurationMs }];
      if (next.length > max) next.shift();
      return next;
    });
  }, [max, defaultDurationMs]);

  const remove = React.useCallback((id) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const ctx = React.useMemo(() => ({ enqueue }), [enqueue]);

  // When mounted, register as the global notify handler
  React.useEffect(() => {
    setNotifyHandler((t) => enqueue(t || {}));
    return () => setNotifyHandler(null);
  }, [enqueue]);

  return (
    <NotifyContext.Provider value={ctx}>
      {children}
      <div className="notifyContainer" aria-live="polite" aria-atomic="false">
        {items.map(it => (
          <Notify
            key={it.id}
            message={it.message}
            kind={it.kind}
            durationMs={it.durationMs}
            onClose={() => remove(it.id)}
            stacked
          />
        ))}
      </div>
    </NotifyContext.Provider>
  );
};

NotifyProvider.propTypes = {
  children: PropTypes.node,
  max: PropTypes.number,
  defaultDurationMs: PropTypes.number
};

// Bridge: listen to global window events fired by notify() fallback or App
if (typeof window !== 'undefined') {
  // Attach once per module load; forward to the currently mounted provider via event
  // We keep a local queue in case no provider is mounted yet
}


