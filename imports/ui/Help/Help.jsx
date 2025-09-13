import React from 'react';
import './Help.css';

export const Help = () => {
  return (
    <div className="help">
      <h2 className="helpTitle">Help & Shortcuts</h2>
      <ul className="helpList">
        <li className="headingSection headingEditing"><span className="bold">Editing</span></li>
        <ul>
          <li><span className="bold">Enter</span> — validate an inline edit (title, fields). In textarea: Enter validates; Shift+Enter inserts a new line.</li>
          <li><span className="bold">Esc</span> — cancel inline editing (input and textarea), restore previous value.</li>
          <li><span className="bold">Shift + Enter</span> (on a task title) — validate and create a new task, focused</li>
          <li><span className="bold">Click on deadline</span> — edit with datepicker; <span className="bold">Esc</span> cancels; <span className="bold">Enter</span> validates</li>
        </ul>
        <li className="headingSection headingAlarm"><span className="bold">Alarm Management</span></li>
        <ul>
          <li><span className="bold">Alarm modal</span> — <span className="bold">1</span> snooze +5m, <span className="bold">2</span> +15m, <span className="bold">3</span> +1h, <span className="bold">Esc</span> dismiss</li>
        </ul>
        <li className="headingSection headingSearch"><span className="bold">Search and Navigation</span></li>
        <ul>
          <li><span className="bold">Global search</span> — <span className="bold">⌘K</span> (macOS) / <span className="bold">Ctrl+K</span> (Windows/Linux) opens the search anywhere</li>
          <li><span className="bold">Search results</span> — <span className="bold">↑/↓</span> navigate results; <span className="bold">Enter</span> opens the selection</li>
          <li><span className="bold">Go to screen</span> — <span className="bold">⌘G</span> (macOS) / <span className="bold">Ctrl+G</span> opens the palette; <span className="bold">↑/↓</span> navigate; <span className="bold">Enter</span> opens; or type the letter</li>
          <li><span className="bold">Back navigation</span> — <span className="bold">⌘ + ←</span> (macOS) / <span className="bold">Ctrl + ←</span> (Windows/Linux) goes back to previous page</li>
          <li><span className="bold">Forward navigation</span> — <span className="bold">⌘ + →</span> (macOS) / <span className="bold">Ctrl + →</span> (Windows/Linux) goes forward to next page</li>
        </ul>
        <li className="headingSection headingFeatures"><span className="bold">Special Features</span></li>
        <ul>
          <li><span className="bold">AI Chat</span> — <span className="bold">⌘D</span> toggle open/close, <span className="bold">⌘⇧D</span> toggle docked sidebar</li>
          <li><span className="bold">Journal</span> — <span className="bold">⌘J</span> opens the Journal page</li>
          <li><span className="bold">Eisenhower</span> — <span className="bold">⌘E</span> (macOS) / <span className="bold">Ctrl+E</span> (Windows/Linux) opens the Eisenhower page</li>
          <li><span className="bold">Cycle fields</span> — <span className="bold">⌘I</span> (macOS) / <span className="bold">Ctrl+I</span> (Windows/Linux) focuses the next visible input/textarea; repeat to cycle</li>
          <li><span className="bold">Reset zoom</span> — <span className="bold">⌘⇧0</span> (macOS) / <span className="bold">Ctrl+Shift+0</span> (Windows/Linux)</li>
          <li><span className="bold">Toggle fullscreen</span> — <span className="bold">⌘⇧9</span> (macOS) / <span className="bold">Ctrl+Shift+9</span> (Windows/Linux)</li>
        </ul>
      </ul>
    </div>
  );
};


