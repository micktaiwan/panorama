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
        <li className="headingSection headingSearch"><span className="bold">Command Palette & Navigation</span></li>
        <ul>
          <li>
            <span className="bold">Command Palette</span> — <span className="bold">⌘K</span> (macOS) / <span className="bold">Ctrl+K</span> (Windows/Linux)
            <ul>
              <li className="muted">Tabs: Search · Create Task · Create Note</li>
              <li>
                <span className="bold">Basics</span>
                <ul>
                  <li>Switch tabs: <span className="bold">Tab</span> / <span className="bold">Shift+Tab</span> (anywhere in palette)</li>
                  <li>Remembers last tab on reopen (unless a page forces it)</li>
                </ul>
              </li>
              <li>
                <span className="bold">Search</span>
                <ul>
                  <li><span className="bold">↑/↓</span> navigate results; <span className="bold">Enter</span> opens</li>
                </ul>
              </li>
              <li>
                <span className="bold">Create Task</span>
                <ul>
                  <li>Project: optionnel, pré‑sélection selon la page</li>
                  <li>Deadline: optionnelle</li>
                </ul>
              </li>
              <li>
                <span className="bold">Create Note</span>
                <ul>
                  <li>Title: optionnel; Enter sur Title → focus Content</li>
                  <li>Content: requis; Enter sur Content → crée la note</li>
                  <li>Project: optionnel, pré‑sélection selon la page</li>
                </ul>
              </li>
            </ul>
          </li>
          <li><span className="bold">Go to screen</span> — <span className="bold">⌘G</span> (macOS) / <span className="bold">Ctrl+G</span> opens the palette; <span className="bold">↑/↓</span> navigate; <span className="bold">Enter</span> opens; or type the letter</li>
          <li><span className="bold">Go to Dashboard</span> — <span className="bold">⌘⇧H</span> (macOS) / <span className="bold">Ctrl+Shift+H</span> (Windows/Linux) or <span className="bold">⌘G</span> then <span className="bold">O</span> (via Go to screen palette)</li>
          <li><span className="bold">Cycle favorite projects</span> — <span className="bold">Tab</span> cycles to next favorite; <span className="bold">Shift+Tab</span> cycles to previous. On <span className="bold">Dashboard</span>, <span className="bold">Tab</span> opens the first favorite. On a <span className="bold">project</span>, <span className="bold">Shift+Tab</span> from the first favorite goes to Dashboard. Ignored when editing fields or when the Command Palette is open.</li>
          <li><span className="bold">Back navigation</span> — <span className="bold">⌘ + ←</span> (macOS) / <span className="bold">Ctrl + ←</span> (Windows/Linux) goes back to previous page</li>
          <li><span className="bold">Forward navigation</span> — <span className="bold">⌘ + →</span> (macOS) / <span className="bold">Ctrl + →</span> (Windows/Linux) goes forward to next page</li>
        </ul>
        <li className="headingSection headingNotes"><span className="bold">Notes</span></li>
        <ul>
          <li>
            <span className="bold">Note Editor</span>
            <ul>
              <li><span className="bold">⌘S / Ctrl+S</span> — Save current note</li>
              <li><span className="bold">⌘W / Ctrl+W</span> — Close current note</li>
              <li><span className="bold">Tab</span> — Indent (insert tab character)</li>
              <li><span className="bold">Shift+Tab</span> — Unindent (remove tab or spaces)</li>
              <li className="muted">Multi-line selection: Tab/Shift+Tab indents/unindents all selected lines</li>
            </ul>
          </li>
          <li>
            <span className="bold">Notes List & Tabs</span>
            <ul>
              <li><span className="bold">⌘W / Ctrl+W</span> — Close note (when focused on list item)</li>
              <li><span className="bold">⌘+Click / Ctrl+Click</span> — Open project associated with note (list or tab)</li>
              <li><span className="bold">Drag & Drop</span> — Reorder tabs</li>
              <li><span className="bold">Right-click</span> — Context menu (rename, close others, close all, delete)</li>
            </ul>
          </li>
        </ul>
        <li className="headingSection headingFeatures"><span className="bold">Special Features</span></li>
        <ul>
          <li><span className="bold">AI Chat</span> — <span className="bold">⌘D</span> toggle open/close, <span className="bold">⌘⇧D</span> toggle docked sidebar</li>
          <li><span className="bold">Journal</span> — <span className="bold">⌘J</span> opens the Journal page</li>
          <li><span className="bold">Eisenhower</span> — <span className="bold">⌘E</span> (macOS) / <span className="bold">Ctrl+E</span> (Windows/Linux) opens the Eisenhower page</li>
          <li><span className="bold">Focus Panorama</span> — <span className="bold">⌘⇧P</span> (macOS) / <span className="bold">Ctrl+Shift+P</span> (Windows/Linux) brings the app to front</li>
          <li><span className="bold">Cycle fields</span> — <span className="bold">⌘I</span> (macOS) / <span className="bold">Ctrl+I</span> (Windows/Linux) focuses the next visible input/textarea; repeat to cycle</li>
          <li><span className="bold">Reset zoom</span> — <span className="bold">⌘⇧0</span> (macOS) / <span className="bold">Ctrl+Shift+0</span> (Windows/Linux)</li>
          <li><span className="bold">Toggle fullscreen</span> — <span className="bold">⌘⇧9</span> (macOS) / <span className="bold">Ctrl+Shift+9</span> (Windows/Linux)</li>
        </ul>
      </ul>
    </div>
  );
};


