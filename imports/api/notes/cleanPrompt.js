export const DEFAULT_CLEAN_PROMPT = `Rules for cleaning notes:
1. Remove all emojis.
2. Remove all markdown symbols (e.g. **, #, >, *) but keep the hierarchy: convert titles and subtitles to plain text lines.
3. Remove timestamps (e.g. "2 minutes ago", "9:14").
4. For email signatures: remove long blocks. Keep only the sender's name and date. Ignore job titles, phone numbers, or disclaimers.
5. Keep the conversation flow and speaker names if it's a dialogue.
6. Keep all original content, do NOT summarize, shorten, or translate.
7. Preserve the original language of the text.
8. Correct obvious spelling mistakes.
Output: plain text only, no markdown, no special formatting, no added text compared to the original`;
