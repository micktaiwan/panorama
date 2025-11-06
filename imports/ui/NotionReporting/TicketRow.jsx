import React from 'react';
import './TicketRow.css';

export const TicketRow = ({ ticket }) => {
  const priorityClass = ticket.priority?.toLowerCase().replace(/\s+/g, '-') || 'none';
  const lifecycleClass = ticket.lifecycle?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'none';

  return (
    <tr className="ticketRow">
      <td className="ticketId">
        #{ticket.id || '—'}
      </td>
      <td className="ticketTitle">
        {ticket.title || '(untitled)'}
      </td>
      <td className="ticketOwner">
        {ticket.owners && ticket.owners.length > 0 ? (
          <div className="ownersList">
            {ticket.owners.map((owner, index) => (
              <span key={owner.id || index} className="ownerBadge">
                {owner.name}
              </span>
            ))}
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className="ticketAge">
        {ticket.age || '—'}
      </td>
      <td className="ticketPriority">
        {ticket.priority ? (
          <span className={`priorityBadge priority-${priorityClass}`}>
            {ticket.priority}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="ticketLifecycle">
        {ticket.lifecycle ? (
          <span className={`lifecycleBadge lifecycle-${lifecycleClass}`}>
            {ticket.lifecycle}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="ticketNextStep">
        {ticket.nextStep || '—'}
      </td>
      <td className="ticketActions">
        {ticket.url ? (
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-link"
          >
            Open in Notion
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
};
