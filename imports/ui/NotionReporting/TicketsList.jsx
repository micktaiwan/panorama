import React from 'react';
import { TicketRow } from './TicketRow.jsx';
import './TicketsList.css';

export const TicketsList = ({ tickets }) => {
  if (!tickets || tickets.length === 0) {
    return (
      <div className="ticketsEmpty">
        <p>No tickets found.</p>
      </div>
    );
  }

  return (
    <div className="ticketsList">
      <table className="ticketsTable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Owner</th>
            <th>Age</th>
            <th>Priority</th>
            <th>Lifecycle</th>
            <th>Next Step</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket, index) => (
            <TicketRow key={ticket.notionId || index} ticket={ticket} />
          ))}
        </tbody>
      </table>
    </div>
  );
};
