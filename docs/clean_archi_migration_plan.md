# Clean Architecture Migration Plan for Panorama

## Executive Summary

This document analyzes the **Clean Architecture** pattern described in `docs/architecture.md` against the current Panorama codebase and provides recommendations for selective adoption.

**Key Finding**: The architecture.md pattern is designed for **enterprise, multi-user TypeScript SaaS applications** (like lemlist/lemwarm), while Panorama is a **single-user, local-first JavaScript tool**. Full adoption would be over-engineering.

**Recommendation**: **Selective adoption** of 4 patterns that provide clear value without requiring TypeScript migration or infrastructure overhaul.

---

## Architecture Comparison

### Recommended Architecture (from architecture.md)

**Target**: Enterprise SaaS with multi-user, distributed teams, complex business logic

**Structure**:
```
{feature}/
├── @types/                           # TypeScript types
├── domain/                           # Pure business logic (client + server)
├── client/
│   ├── component/                    # React components
│   ├── hook/                         # React hooks
│   └── store/                        # Zustand stores
├── server/
│   ├── controller/                   # Methods + Routes (thin, delegates)
│   ├── use-case/                     # Business orchestration
│   ├── service/                      # Reusable business logic
│   ├── repository/                   # DB access ONLY
│   ├── domain/                       # Server-only pure logic
│   └── {feature}-decorator.ts        # Extends LemappDecorator
├── test/e2e/                         # Playwright E2E tests
├── {feature}-code.ts                 # Error code enum
├── {feature}-log.ts                  # User-facing messages
├── {feature}-conf.ts                 # Constants
└── {feature}-conf-e2e.ts             # E2E selectors
```

**Language**: TypeScript with strict typing

**Layers**: 5 layers (Controller → Use-Case → Service → Repository → Domain)

**Testing**: Unit tests + E2E with Playwright + Page Object Model

**Decorators**: LemappDecorator for cross-cutting concerns

---

### Current Panorama Architecture

**Nature**: Single-user, local-first personal productivity tool

**Structure**:
```
imports/api/{module}/
├── collections.js                    # MongoDB collection
├── methods.js                        # CRUD + business logic (async)
└── publications.js                   # Data subscriptions
```

**Language**: JavaScript (no TypeScript)

**Layers**: Flat (no explicit layers)
- Business logic directly in Meteor methods
- DB access directly in methods (no repository layer)
- No use-case/service separation

**Testing**: Minimal (basic Mocha setup, few tests)

**Decorators**: None

---

## Gap Analysis

| Aspect | Architecture.md | Panorama | Gap Level |
|--------|-----------------|----------|-----------|
| **Language** | TypeScript with strict types | JavaScript | **High** |
| **Module structure** | 5-layer separation | Flat structure | **High** |
| **DB access** | Repository layer only | Direct in methods | **High** |
| **Business logic** | Use-case + Service layers | In methods | **High** |
| **Pure functions** | Domain layer (shared + server) | Scattered in methods | Medium |
| **Error handling** | Code enum + Log object (1:1) | Ad-hoc Meteor.Error | Medium |
| **Constants** | Centralized conf.ts files | In-place magic values | Low |
| **Testing** | Unit + E2E with Playwright | Minimal | Medium |
| **Decorators** | LemappDecorator infrastructure | None | **High** |
| **E2E selectors** | Centralized conf-e2e.ts | N/A | N/A |

---

## My Recommendation: Selective Adoption

### ✅ Worth Adopting (Concrete Value)

#### 1. Repository Pattern (Pilot: 1-2 modules)

**What**: Extract database operations into dedicated repository files

**Why**:
- Decouples business logic from MongoDB API
- Makes business logic testable without DB mocking
- Allows switching from MongoDB to another store later
- Reduces code duplication

**Example**: `imports/api/tasks/repository.js`

**Before** (`tasks/methods.js`):
```javascript
Meteor.methods({
  async 'tasks.insert'(doc) {
    check(doc, Object);
    const now = new Date();
    const sanitized = sanitizeTaskDoc(doc);

    // Business logic mixed with DB calls
    if (sanitized.projectId) {
      const projectId = String(sanitized.projectId);
      const openSelector = {
        projectId,
        $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ]
      };
      // Direct DB call
      await TasksCollection.updateAsync(openSelector, { $inc: { priorityRank: 1 } }, { multi: true });
      sanitized.priorityRank = 0;
    }

    // Duplicate check - direct DB call
    if (doc?.source && doc.source.kind === 'userLog') {
      const existing = await TasksCollection.findOneAsync({ 'source.kind': 'userLog', 'source.logEntryIds': { $in: logIds } });
      if (existing) throw new Meteor.Error('duplicate-task', '...');
    }

    // Direct DB insert
    const _id = await TasksCollection.insertAsync({ ... });

    // Update related entity - direct DB call
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    return _id;
  }
});
```

**After** (`tasks/repository.js`):
```javascript
import { TasksCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

export const TasksRepository = {
  async findById(taskId) {
    return await TasksCollection.findOneAsync(taskId);
  },

  async findByProjectId(projectId, options = {}) {
    return await TasksCollection.find({ projectId }, options).fetchAsync();
  },

  async findOpenByProjectId(projectId) {
    const selector = {
      projectId,
      $or: [{ status: { $exists: false } }, { status: { $nin: ['done', 'cancelled'] } }]
    };
    return await TasksCollection.find(selector).fetchAsync();
  },

  async findByUserLogIds(logEntryIds) {
    return await TasksCollection.findOneAsync({
      'source.kind': 'userLog',
      'source.logEntryIds': { $in: logEntryIds }
    }, { fields: { _id: 1 } });
  },

  async shiftOpenTasksDown(projectId) {
    const openSelector = {
      projectId,
      $or: [{ status: { $exists: false } }, { status: { $nin: ['done', 'cancelled'] } }]
    };
    return await TasksCollection.updateAsync(
      openSelector,
      { $inc: { priorityRank: 1 } },
      { multi: true }
    );
  },

  async insert(doc) {
    return await TasksCollection.insertAsync(doc);
  },

  async update(taskId, modifier) {
    return await TasksCollection.updateAsync(taskId, modifier);
  },

  async remove(taskId) {
    return await TasksCollection.removeAsync(taskId);
  },

  async touchProjectTimestamp(projectId) {
    return await ProjectsCollection.updateAsync(
      projectId,
      { $set: { updatedAt: new Date() } }
    );
  }
};
```

**After** (`tasks/methods.js`):
```javascript
import { TasksRepository } from './repository';

Meteor.methods({
  async 'tasks.insert'(doc) {
    check(doc, Object);
    const now = new Date();
    const sanitized = sanitizeTaskDoc(doc);

    // Business logic - no DB calls
    if (sanitized.projectId) {
      await TasksRepository.shiftOpenTasksDown(sanitized.projectId);
      sanitized.priorityRank = 0;
    }

    // Duplicate guard - through repository
    if (doc?.source && doc.source.kind === 'userLog') {
      const existing = await TasksRepository.findByUserLogIds(doc.source.logEntryIds);
      if (existing) throw new Meteor.Error('duplicate-task', '...');
    }

    // Insert through repository
    const _id = await TasksRepository.insert({ ... });

    // Update related entity
    if (doc.projectId) {
      await TasksRepository.touchProjectTimestamp(doc.projectId);
    }

    return _id;
  }
});
```

**Files to create**:
- `imports/api/tasks/repository.js` (pilot)
- `imports/api/projects/repository.js` (when refactoring related methods)
- Pattern can be replicated to 37 other modules incrementally

**Benefits**:
- Methods become testable without MongoDB
- Query patterns centralized (easier to optimize)
- Easier to add caching layer later
- Business logic separated from persistence

---

#### 2. Domain Layer (Pure Functions)

**What**: Extract pure business logic functions into `domain/` folder (shared client+server)

**Why**:
- Pure functions are easy to test
- Reusable across client and server
- No side effects = predictable behavior
- Can be used in UI without server calls

**Example**: `imports/api/tasks/domain/tasks-domain.js`

**Before** (scattered in methods):
```javascript
// In tasks/methods.js
const sanitized = sanitizeTaskDoc(doc);
// ... more logic mixed with DB calls
```

**After** (`tasks/domain/tasks-domain.js`):
```javascript
/**
 * Pure business logic for tasks
 * NO database access, NO HTTP calls, NO async operations
 * Can be imported by client OR server
 */

export function sanitizeTaskDoc(input) {
  const out = { ...input };
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (typeof out.status === 'string') out.status = out.status.trim();
  if (typeof out.priorityRank !== 'undefined') {
    const n = Number(out.priorityRank);
    out.priorityRank = Number.isFinite(n) ? n : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'isUrgent')) {
    out.isUrgent = Boolean(out.isUrgent);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'isImportant')) {
    out.isImportant = Boolean(out.isImportant);
  }
  return out;
}

export function isTaskOverdue(task) {
  if (!task.deadline) return false;
  const now = new Date();
  const deadline = new Date(task.deadline);
  return deadline < now && task.status !== 'done';
}

export function calculateTaskPriority(task) {
  const urgentWeight = task.isUrgent ? 2 : 1;
  const importantWeight = task.isImportant ? 2 : 1;
  const overdueWeight = isTaskOverdue(task) ? 3 : 1;
  return urgentWeight * importantWeight * overdueWeight;
}

export function buildVectorSearchText(task) {
  return `${task.title || ''} ${task.notes || ''}`.trim();
}
```

**After** (`tasks/methods.js`):
```javascript
import { sanitizeTaskDoc, buildVectorSearchText } from './domain/tasks-domain';

Meteor.methods({
  async 'tasks.insert'(doc) {
    const sanitized = sanitizeTaskDoc(doc); // Pure function from domain
    // ... rest of method
    const text = buildVectorSearchText(sanitized); // Pure function
    await upsertDoc({ kind: 'task', id: _id, text, ... });
  }
});
```

**Files to create**:
- `imports/api/tasks/domain/tasks-domain.js`
- `imports/api/projects/domain/projects-domain.js`
- `imports/api/notes/domain/notes-domain.js`
- Repeat for modules with business logic

**Benefits**:
- Pure functions are trivial to test (no mocks needed)
- Client can use same validation/calculation logic
- Business rules centralized in one place
- Zero dependencies = maximum reusability

---

#### 3. Constants in Conf Files

**What**: Move magic values to `<module>-conf.js` files

**Why**:
- No scattered literals throughout code
- Easy to tune without hunting for values
- Self-documenting (constant names explain purpose)
- Single source of truth

**Example**: `imports/api/tasks/tasks-conf.js`

**Before** (scattered magic values):
```javascript
// In methods.js
if (doc.source.logEntryIds.length > 0) { ... }
doc.source.logEntryIds.slice(0, 20) // Magic number!
// In UI
<input maxLength={200} /> // Magic number!
// In AI prompts
if (tasks.length > 50) { ... } // Magic number!
```

**After** (`tasks/tasks-conf.js`):
```javascript
/**
 * Constants for Tasks module
 * All magic values centralized here
 */

// Task status values
export const TASK_STATUS_TODO = 'todo';
export const TASK_STATUS_DOING = 'doing';
export const TASK_STATUS_DONE = 'done';
export const TASK_STATUS_CANCELLED = 'cancelled';

export const TASK_STATUSES_OPEN = [TASK_STATUS_TODO, TASK_STATUS_DOING];
export const TASK_STATUSES_CLOSED = [TASK_STATUS_DONE, TASK_STATUS_CANCELLED];

// Limits
export const TASK_MAX_LOG_ENTRY_IDS = 20;
export const TASK_MAX_TITLE_LENGTH = 200;
export const TASK_MAX_NOTES_LENGTH = 10000;

// AI/search
export const TASK_MAX_SIMILAR_SUGGESTIONS = 50;
export const TASK_VECTOR_SEARCH_TOP_K = 10;

// Priority weights
export const TASK_PRIORITY_WEIGHT_URGENT = 2;
export const TASK_PRIORITY_WEIGHT_IMPORTANT = 2;
export const TASK_PRIORITY_WEIGHT_OVERDUE = 3;
```

**After** (using constants):
```javascript
import {
  TASK_MAX_LOG_ENTRY_IDS,
  TASK_MAX_TITLE_LENGTH,
  TASK_STATUSES_OPEN
} from './tasks-conf';

// In methods.js
doc.source.logEntryIds.slice(0, TASK_MAX_LOG_ENTRY_IDS)

// In UI
<input maxLength={TASK_MAX_TITLE_LENGTH} />

// In domain
export function isTaskOpen(task) {
  return TASK_STATUSES_OPEN.includes(task.status);
}
```

**Files to create**:
- `imports/api/tasks/tasks-conf.js`
- `imports/api/projects/projects-conf.js`
- Repeat for all 37 modules with magic values

**Benefits**:
- No more hunting for magic values
- Easy experimentation (change in one place)
- Self-documenting code
- Easier code review (constants explain intent)

---

#### 4. Error Code Pattern

**What**: Create error code enums with 1:1 mapping to user messages

**Why**:
- Consistent error handling across app
- Easy to internationalize later
- Structured error responses
- Better error tracking/monitoring

**Example**: `imports/api/tasks/tasks-codes.js` + `tasks-logs.js`

**Before** (ad-hoc errors):
```javascript
// Scattered string literals
throw new Meteor.Error('duplicate-task', 'A task already exists for at least one of these journal entries');
throw new Meteor.Error('task-not-found', 'Task not found');
throw new Meteor.Error('invalid-status', 'Status must be todo, doing, done, or cancelled');
```

**After** (`tasks/tasks-codes.js`):
```javascript
/**
 * Error codes for Tasks module
 * Pattern: TASK_[ACTION]_[ERROR_TYPE]
 */
export const TasksCodes = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_DUPLICATE: 'TASK_DUPLICATE',
  TASK_INVALID_STATUS: 'TASK_INVALID_STATUS',
  TASK_INVALID_PRIORITY: 'TASK_INVALID_PRIORITY',
  TASK_PROJECT_NOT_FOUND: 'TASK_PROJECT_NOT_FOUND',
  TASK_UPDATE_FAILED: 'TASK_UPDATE_FAILED',
  TASK_DELETE_FAILED: 'TASK_DELETE_FAILED'
};
```

**After** (`tasks/tasks-logs.js`):
```javascript
/**
 * User-facing error messages for Tasks module
 * MUST have 1:1 mapping with TasksCodes
 */
import { TasksCodes } from './tasks-codes';

export const tasksLogs = {
  [TasksCodes.TASK_NOT_FOUND]: 'Task not found',
  [TasksCodes.TASK_DUPLICATE]: 'A task already exists for at least one of these journal entries',
  [TasksCodes.TASK_INVALID_STATUS]: 'Status must be todo, doing, done, or cancelled',
  [TasksCodes.TASK_INVALID_PRIORITY]: 'Priority rank must be a number',
  [TasksCodes.TASK_PROJECT_NOT_FOUND]: 'Project not found',
  [TasksCodes.TASK_UPDATE_FAILED]: 'Failed to update task',
  [TasksCodes.TASK_DELETE_FAILED]: 'Failed to delete task'
};
```

**After** (using error codes):
```javascript
import { TasksCodes } from './tasks-codes';
import { tasksLogs } from './tasks-logs';

// In methods.js
if (!task) {
  throw new Meteor.Error(TasksCodes.TASK_NOT_FOUND, tasksLogs[TasksCodes.TASK_NOT_FOUND]);
}

if (existing) {
  throw new Meteor.Error(TasksCodes.TASK_DUPLICATE, tasksLogs[TasksCodes.TASK_DUPLICATE]);
}

// In UI error handling
catch (error) {
  const message = tasksLogs[error.error] || 'An unexpected error occurred';
  Notify.error(message);
}
```

**Files to create**:
- `imports/api/tasks/tasks-codes.js`
- `imports/api/tasks/tasks-logs.js`
- `imports/api/_shared/app-codes.js` (common errors)
- `imports/api/_shared/app-logs.js`
- Repeat for all 37 modules

**Benefits**:
- Consistent error format
- Easy to translate (isolate strings in logs file)
- Better error tracking (can count by code)
- Self-documenting (code enum shows all possible errors)

---

### ❌ NOT Worth Adopting (Over-engineering)

#### 1. TypeScript Migration

**Why NOT**:
- **Massive effort**: Convert 37 modules + UI components
- **Limited benefit**: Panorama is single-user, types won't prevent user errors
- **No type errors currently**: Project runs fine without TS
- **Local-first nature**: No distributed team benefits from type safety

**Alternative**: Add JSDoc type annotations to critical functions if needed

---

#### 2. Full 5-Layer Architecture (Controller → Use-Case → Service → Repository)

**Why NOT**:
- **Over-engineered**: Use-Case + Service adds indirection for simple CRUD
- **Panorama's simplicity**: Most operations are straightforward (insert task, update note)
- **No reusability need**: Service layer shines when multiple use-cases share logic (rare in Panorama)
- **Maintenance burden**: More files to navigate for simple changes

**Alternative**: Use Repository pattern only (3 layers: Method → Repository → DB)

---

#### 3. Decorator Infrastructure (LemappDecorator)

**Why NOT**:
- **No base class exists**: Would need to build entire decorator system
- **Complexity**: TypeScript decorators require experimental flags
- **Limited use cases**: Panorama doesn't have complex cross-cutting concerns like:
  - Feature flags (single user)
  - Permissions (single user)
  - Multi-tenant logic (single user)

**Alternative**: Use simple wrapper functions for logging/timing if needed

---

#### 4. E2E Testing with Playwright

**Why NOT**:
- **Overkill**: Personal tool with single user
- **Maintenance cost**: E2E tests break with UI changes
- **Electron complexity**: Desktop app E2E is harder than web
- **Manual testing works**: Single user can verify changes quickly

**Alternative**: Add unit tests for critical business logic (domain layer)

---

## Migration Roadmap

### Phase 1: Pilot (1 module)

**Goal**: Validate patterns without committing fully

**Module**: `tasks` (most complex module, good test case)

**Actions**:
1. Create `imports/api/tasks/repository.js` - extract all DB calls from `tasks/methods.js`
2. Create `imports/api/tasks/domain/tasks-domain.js` - extract pure functions
3. Create `imports/api/tasks/tasks-conf.js` - move magic values
4. Create `imports/api/tasks/tasks-codes.js` + `tasks-logs.js` - error codes
5. Refactor `tasks/methods.js` to use new files
6. Write unit tests for domain layer

**Success criteria**:
- Methods are shorter and more readable
- Domain functions are tested
- No regressions in task functionality

**Estimated files**: 6 new files, 1 refactored file

---

### Phase 2: Expand (5-10 modules)

**Modules**: `projects`, `notes`, `noteSessions`, `budget`, `calendar`

**Actions**: Replicate Phase 1 patterns to selected modules

**Success criteria**: Consistent structure across critical modules

---

### Phase 3: Complete (remaining modules)

**Modules**: All 37 modules

**Actions**: Apply patterns incrementally (can be done opportunistically during feature work)

---

## Benefits Summary

### Immediate Benefits (Post-Pilot)

| Benefit | Impact | Example |
|---------|--------|---------|
| **Testability** | High | Domain functions testable without DB mocks |
| **Code clarity** | High | Methods focus on orchestration, not DB syntax |
| **Maintainability** | Medium | Constants easy to tune, errors easy to track |
| **Refactoring safety** | Medium | Repository isolates DB changes |

### Long-term Benefits

| Benefit | Impact | Example |
|---------|--------|---------|
| **Store migration** | High | Switch from MongoDB to SQLite/PostgreSQL without touching methods |
| **Client-side logic** | Medium | Reuse domain functions in UI (e.g., validate before submit) |
| **AI integration** | Medium | Pure functions easier for LLM to understand and generate |
| **Performance** | Low | Repository layer enables caching without changing methods |

---

## Cost-Benefit Analysis

### Adopting Repository + Domain + Conf + Error Codes

**Effort**:
- Pilot: ~2-3 hours per module (6-9 hours total for tasks)
- Expansion: ~1-2 hours per module (5-10 hours for 5 modules)
- Complete: ~30-40 hours for all 37 modules (can be spread over time)

**Benefits**:
- ✅ Testable business logic
- ✅ Clearer code structure
- ✅ Easier refactoring
- ✅ Better error handling

**Risk**: Low (patterns are incremental, no breaking changes)

---

### NOT Adopting TypeScript + Full Layers + Decorators + E2E

**Effort Saved**: ~200-300 hours (TypeScript migration alone is 100+ hours)

**Trade-offs**:
- ❌ No compile-time type safety (acceptable for single-user app)
- ❌ No decorator magic (not needed for simple app)
- ❌ No automated E2E tests (manual testing sufficient)

**Risk Avoided**: High (major refactor with limited benefit)

---

## Conclusion

**Adopt selectively**: Repository, Domain, Conf, Error Codes patterns provide concrete value for Panorama without requiring TypeScript or infrastructure overhaul.

**Do NOT adopt**: Full 5-layer architecture, TypeScript migration, decorators, E2E testing - these are over-engineering for a single-user, local-first tool.

**Approach**: Start with tasks module pilot, validate benefits, then expand incrementally to other modules.

---

## Appendix: Quick Reference

### File Naming Conventions (Adopted)

```
imports/api/{module}/
├── collections.js              # Existing
├── methods.js                  # Existing (refactored)
├── publications.js             # Existing
├── repository.js               # NEW
├── domain/
│   └── {module}-domain.js      # NEW
├── {module}-conf.js            # NEW
├── {module}-codes.js           # NEW
└── {module}-logs.js            # NEW
```

### Import Pattern Example

```javascript
// In methods.js
import { TasksRepository } from './repository';
import { sanitizeTaskDoc, buildVectorSearchText } from './domain/tasks-domain';
import { TASK_MAX_LOG_ENTRY_IDS, TASK_STATUSES_OPEN } from './tasks-conf';
import { TasksCodes } from './tasks-codes';
import { tasksLogs } from './tasks-logs';

Meteor.methods({
  async 'tasks.insert'(doc) {
    const sanitized = sanitizeTaskDoc(doc);
    if (existing) {
      throw new Meteor.Error(TasksCodes.TASK_DUPLICATE, tasksLogs[TasksCodes.TASK_DUPLICATE]);
    }
    const _id = await TasksRepository.insert({ ... });
    return _id;
  }
});
```

### Testing Pattern Example

```javascript
// In domain/tasks-domain.test.js
import { assert } from 'chai';
import { sanitizeTaskDoc, isTaskOverdue } from './tasks-domain';

describe('tasks-domain', () => {
  describe('sanitizeTaskDoc', () => {
    it('should trim title', () => {
      const input = { title: '  Test Task  ' };
      const result = sanitizeTaskDoc(input);
      assert.equal(result.title, 'Test Task');
    });

    it('should coerce isUrgent to boolean', () => {
      const input = { isUrgent: 'true' };
      const result = sanitizeTaskDoc(input);
      assert.strictEqual(result.isUrgent, true);
    });
  });

  describe('isTaskOverdue', () => {
    it('should return true for past deadline', () => {
      const task = { deadline: new Date('2020-01-01'), status: 'todo' };
      assert.isTrue(isTaskOverdue(task));
    });

    it('should return false for completed task', () => {
      const task = { deadline: new Date('2020-01-01'), status: 'done' };
      assert.isFalse(isTaskOverdue(task));
    });
  });
});
```
