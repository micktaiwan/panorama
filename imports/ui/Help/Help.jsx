import React from 'react';
import './Help.css';

export const Help = () => {
  return (
    <div className="help">
      <h2 className="helpTitle">Help & Shortcuts</h2>
      <ul className="helpList">
        <li className="headingSection headingEditing"><strong>Editing</strong></li>
        <ul>
          <li><strong>Enter</strong> — validate an inline edit (title, fields). In textarea: Enter validates; Shift+Enter inserts a new line.</li>
          <li><strong>Esc</strong> — cancel inline editing (input and textarea), restore previous value.</li>
          <li><strong>Shift + Enter</strong> (on a task title) — validate and create a new task, focused</li>
          <li><strong>Click on deadline</strong> — edit with datepicker; <strong>Esc</strong> cancels; <strong>Enter</strong> validates</li>
        </ul>
        <li className="headingSection headingAlarm"><strong>Alarm Management</strong></li>
        <ul>
          <li><strong>Alarm modal</strong> — <strong>1</strong> snooze +5m, <strong>2</strong> +15m, <strong>3</strong> +1h, <strong>Esc</strong> dismiss</li>
        </ul>
        <li className="headingSection headingSearch"><strong>Search and Navigation</strong></li>
        <ul>
          <li><strong>Global search</strong> — <strong>⌘K</strong> (macOS) / <strong>Ctrl+K</strong> (Windows/Linux) opens the search anywhere</li>
          <li><strong>Search results</strong> — <strong>↑/↓</strong> navigate results; <strong>Enter</strong> opens the selection</li>
          <li><strong>Go to screen</strong> — <strong>⌘G</strong> (macOS) / <strong>Ctrl+G</strong> opens the palette; <strong>↑/↓</strong> navigate; <strong>Enter</strong> opens; or type the letter</li>
          <li><strong>Back navigation</strong> — <strong>⌘ + ←</strong> (macOS) / <strong>Ctrl + ←</strong> (Windows/Linux) goes back to previous page</li>
          <li><strong>Forward navigation</strong> — <strong>⌘ + →</strong> (macOS) / <strong>Ctrl + →</strong> (Windows/Linux) goes forward to next page</li>
        </ul>
        <li className="headingSection headingFeatures"><strong>Special Features</strong></li>
        <ul>
          <li><strong>AI Chat</strong> — <strong>⌘D</strong> toggle open/close, <strong>⌘⇧D</strong> toggle docked sidebar</li>
          <li><strong>Journal</strong> — <strong>⌘J</strong> opens the Journal page</li>
          <li><strong>Eisenhower</strong> — <strong>⌘E</strong> (macOS) / <strong>Ctrl+E</strong> (Windows/Linux) opens the Eisenhower page</li>
          <li><strong>Cycle fields</strong> — <strong>⌘I</strong> (macOS) / <strong>Ctrl+I</strong> (Windows/Linux) focuses the next visible input/textarea; repeat to cycle</li>
          <li><strong>Reset zoom</strong> — <strong>⌘⇧0</strong> (macOS) / <strong>Ctrl+Shift+0</strong> (Windows/Linux)</li>
          <li><strong>Toggle fullscreen</strong> — <strong>⌘⇧9</strong> (macOS) / <strong>Ctrl+Shift+9</strong> (Windows/Linux)</li>
        </ul>
      </ul>
    </div>
  );
};


