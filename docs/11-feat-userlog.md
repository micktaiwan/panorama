# UserLog (Board Journal) Feature

## Summary

The team discussed building a specialized “board journal” feature to log interruptions and resume tasks throughout the day. It will be a dedicated overlay module, simpler than full note sessions, with manual timestamping and metadata entry. Initially there will be no task linking or multi-line input, manual autosave via Enter, and a keyboard shortcut to open the quick note. Tags will be simple text codes at note start, with plans for an auto-tag parser and collapsible display options in later iterations.

## Decisions

- Use a dedicated module rather than extending note sessions [L15]
- No multi-line input for journal entries [L16]
- Do not link entries to tasks initially [L10]
- Autosave manually upon pressing Enter [L13]
- Timestamp every entry [L8]
- Use simple text-based tags at the start of each note [L14]
- Provide an overlay interface for quick journaling [L5]
- Implement a keyboard shortcut to open the quick note [L12]

## Clarifications

- No route necessary: we have a panel always visible (or callable by a shortcut)
- No relation with session notes, but we can consider reusing a common component to display a journal (in tilde/overlay) or a session note (on the dedicated page)
- Retention: we keep everything

## Next steps

- Prepare a common component
- Define a simple MVP and iterate over time [L7]
- Design and build the overlay-based specialized UI [L5]
- Implement manual timestamping for each entry [L8]
- Configure a keyboard shortcut to launch the journal [L12]
- Develop manual autosave triggered by Enter [L13]
- Build the dedicated journal module [L15]
- Plan and prototype an automatic tag parser [L17]
- Decide on tagging options for a later phase [L11]
