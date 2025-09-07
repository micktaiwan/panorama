# Situation Analysis Tool – Feature Specification

## Overview

The Situation Analysis Tool is a module integrated into Panorama.  
Its goal is to help analyze complex situations (team conflicts, incidents, organizational challenges) by:

- Structuring the situation context (problem description, actors, and roles).
- Automatically generating tailored interview questions for each actor.
- Organizing collected notes and AI-generated summaries into actionable insights.

This tool does **not** include a voice recorder or transcription system.  
It focuses solely on structured text input, context engineering, and AI-powered output generation.

---

## User Workflow

1. **Input a Situation**
   - The user writes a free-text description of a situation (Slack threads, meeting notes, or manual summaries).
   - Example:  
     *"Charles is upset with Eliott (lead data engineer) after a $40K BigQuery incident. Ahmed ran the query. Eliott feels unfairly blamed. There are frustrations between Data and PMs, plus complaints about delays, but feedback is mixed. I want to investigate without bias."*

2. **Define Actors and Roles**
   - The user lists all actors involved (e.g., Charles – CEO, Eliott – Lead Data Engineer, Ahmed – Data Scientist).
   - Actors can be manually added or auto-extracted by the AI.

3. **Question Generator (Key Feature)**
   - The system generates **custom interview questions for each actor** based on the situation and their role.
   - Questions aim to clarify facts, capture perspectives, and identify root causes.
   - Example output:

     ```json
     {
       "actor": "Charles",
       "questions": [
         "Can you describe specific examples of frustrations with the Data team?",
         "Do you see this incident as a one-off mistake or a systemic issue?",
         "What type of reporting or communication would improve trust?",
         "Which improvements would you prioritize: speed, visibility, or accuracy?",
         "Who do you feel should take ownership of this situation?"
       ]
     }
     ```

4. **Interview Notes Section**
   - For each actor, the user enters free-text notes from interviews or discussions.
   - Markdown formatting is supported for clarity and structure.

5. **Summary & Action Plan Generator**
   - After collecting interview notes, the system produces:
     - A **neutral summary** of findings.
     - A **problem analysis table**:

       | Problem | Root Cause | Impact | Suggested Solution |
       |---------|------------|--------|-------------------|
       | Costly BigQuery query | Lack of cost alerting | $40K expense | Add query budget limits and training |

     - A **top 3–5 action plan** with priorities.

---

## Core Components

1. **Situation Parser**
   - Input: Free-text description of the situation.
   - Output: Structured JSON context with:
     - `situation_summary`
     - `actors` (with name and role)
     - `problems_detected`

2. **Question Generator**
   - Input: Situation JSON (actors + detected problems).
   - Output: Tailored question sets for each actor.

3. **Interview Notes Manager**
   - Markdown-based notes editor to document interviews.

4. **Summary & Action Plan Generator**
   - Produces executive summaries, problem tables, and prioritized actions.

---

## Technical Requirements

- **Frontend Integration:**
  - New route: `#/situation-analyzer`.
  - Add a link to the route in the app footer.
  - UI should include:
    - Text input for situation description.
    - Editable table/list for actors and roles.
    - Auto-generated questions display.
    - Notes editor with Markdown support.
    - Summary and action plan viewer.

- **Backend / AI Logic:**
  - Provider: OpenAI Chat Completions API (`model: o4-mini`).
  - Follow the same client pattern as `imports/api/reporting/ai.js`.
  - Use the API for:
    - Parsing free text into a simple situation JSON.
    - Generating targeted questions per actor.
    - Summarizing interviews and creating action plans.
  - Design prompts for neutrality and actionable insights.
  - Keep calls stateless; persist results locally.
  - Prompt helpers and schemas centralized in `imports/api/situations/promptHelpers.js`.
  - Use `logOpenAiPayload(name, system, user)` to standardize payload logging.

- **Data Storage:**
  - Store all data (situations, actors, questions, notes, summaries) in the
    existing database.

### MVP Data Model (Option B — separate collections)

- Keep the schema minimal; do not anticipate future features.
- Collections and fields (MVP):
  - `Situations`:
    - `_id`, `title`, `description`, `createdAt`, `updatedAt`.
  - `SituationActors`:
    - `_id`, `situationId`, `personId`, `name`, `role` (company snapshot), `situationRole` (role in the situation), `createdAt`, `updatedAt`.
  - `SituationQuestions` (one doc per actor run):
    - `_id`, `situationId`, `actorId`, `questions` (array of `{ q, r }`), `createdAt`.
  - `SituationNotes`:
    - `_id`, `situationId`, `actorId` (optional), `content` (markdown), `createdAt`.
  - `SituationSummaries`:
    - `_id`, `situationId`, `text`, `createdAt`.

Notes:

- For MVP, overwrite questions and summaries on each generation.
- Problems detection is optional and can be derived by the AI when needed.

- **Extensibility:**  
  - Build components so future features can be added:
    - Sentiment analysis on interview notes.
    - Heatmap of recurring issues.
    - Automatic actor extraction (NER).

---

## Example Prompt for Question Generation

```text
You are a neutral investigation assistant.
You receive:
- A situation description
- A list of actors with their roles
- A set of detected problems

Your goal:
1. Generate 5–7 neutral and insightful questions for each actor.
2. Questions must clarify facts, capture perspectives, and uncover root causes.
3. Avoid blame; focus on understanding context and identifying improvements.

Output in JSON:
{
  "actor": "Name",
  "questions": ["Q1", "Q2", "Q3"]
}


---

## Roadmap

- [x] Basic page at `#/situation-analyzer` with footer link.
- [x] Create collections (Situations, SituationActors, SituationQuestions,
  SituationNotes, SituationSummaries).
- [x] CRUD for situations and actors.
- [x] Generate questions per actor via `o4-mini` with strict JSON schema.
- [x] Notes editor (textarea). (Preview optional later.)
- [x] Generate summary and action plan via `o4-mini` (plain text, no tables, French).
- [x] Wire publications and subscriptions.

Enhancements (done):
- [x] Centralize prompt helpers and JSON schemas (`imports/api/situations/promptHelpers.js`).
- [x] Standardize LLM logging with `logOpenAiPayload(name, system, user)`.
- [x] Introduce `situationRole` (role in the situation) alongside company role; editable inline.
- [x] Actor auto-detection: prefer `personId` from People roster; robust disambiguation.
- [x] Exclude `Left` people from question generation.
- [x] Deep-link from actor name to People page; one-shot highlight.
- [x] Persist last selected situation in localStorage.
- [x] Add confirmation modal and cascading delete for situations (actors, notes, questions, summaries).
