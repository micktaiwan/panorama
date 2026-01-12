---
globs: *.ts, *.tsx, tsconfig.json 
alwaysApply: false
---

# Feature Architecture and Structure

## Verification Principles - MUST BE RESPECTED

Before applying this rule:

1. **Check existing code**: Read the relevant files to understand current structure
2. **Extract citations**: If you identify a problem, cite the exact missing/misplaced file
3. **Admit uncertainty**: If you're not sure a rule applies, say "I don't have enough information to verify this with confidence"
4. **Anchor in the project**: Base your suggestions ONLY on project code, not general knowledge

**Mandatory suggestion format:**

```
1. Citation of current structure (list existing files)
2. Missing/misplaced files identified
3. Proposed solution with rule citation
```

If you cannot verify the current structure, DO NOT make the suggestion.

## Mandatory Feature Structure

Every new feature SHOULD follow this exact structure.

**BEFORE applying this rule:**

1. Check if the file/feature already exists: read the current structure
2. If it's an existing feature that doesn't follow the structure, ask for confirmation before proposing massive restructuring
3. If you're not sure about the feature type (new vs existing, legacy vs modern), say: "I don't have enough information to determine if this rule applies"

**To suggest a modification:**

- Cite the missing or misplaced files with their current path
- Propose the new path by referencing this rule
- If all required files are present and properly placed, suggest nothing

### Location

Features must be stored in:

- `lemapp/imports/{domain}/{feature-name}/` (preferred)
- `lemapp/modules/{feature-name}/` (legacy, acceptable)

**Examples:**

- ✅ `imports/lemlist/watch-list/`
- ✅ `imports/lemgod/metrics/`
- ✅ `modules/company-is-hiring/`
- ✅ `modules/linkedin-signals/`

### Mandatory Directory Structure

```
{feature-name}/
├── @types/
│   └── {feature-name}.d.ts                    # Shared types (client + server)
├── client/                                     # Client code only
│   ├── @types/
│   │   └── {feature-name}.d.ts                # Client-specific types
│   ├── component/
│   │   ├── common/                            # Reusable components
│   │   ├── layout/                            # Layouts (modals, panels)
│   │   │   ├── modal/
│   │   │   └── panel/
│   │   └── view/                              # Feature views
│   ├── hook/                                  # React hooks (use-{feature}-{name}.ts)
│   ├── context/                               # React contexts
│   ├── store/                                 # Zustand stores ({feature}-store.ts)
│   └── {feature}-module.ts                    # Client-only pure functions (optional)
├── domain/                                     # NEW: Shared pure business logic (client + server)
│   ├── {feature}-domain.ts                    # Pure functions, NO DB/HTTP/async
│   └── {feature}-domain.test.ts               # Domain logic tests
├── server/                                     # Server code only
│   ├── controller/                            # NEW: Methods + Routes
│   │   ├── {feature}-method.ts                # Meteor methods (delegates to use-case)
│   │   ├── {feature}-route.ts                 # API routes
│   │   └── {feature}-specific-method.ts       # Optional: specific methods
│   ├── cron/                                  # NEW: Cron jobs grouped
│   │   └── {feature}-cron.ts                  # Cron tasks
│   ├── domain/                                # NEW: Server-specific domain logic
│   │   ├── {feature}-domain.ts                # Server-only pure functions
│   │   ├── {feature}-domain.test.ts           # Domain tests
│   │   └── {feature}-specific-domain.ts       # Optional: specific domain logic
│   ├── repository/                            # NEW: DB access layer
│   │   └── {feature}-repository.ts            # DB operations only, NO business logic
│   ├── service/                               # NEW: Reusable business logic
│   │   ├── {feature}-service.ts               # Business logic services
│   │   ├── {feature}-service.test.ts          # Service tests
│   │   └── {feature}-specific-service.ts      # Optional: specific services
│   ├── use-case/                              # NEW: Main orchestrator
│   │   ├── {feature}-use-case.ts              # Use-case orchestrator (was {feature}.ts)
│   │   ├── {feature}-use-case.test.ts         # Use-case tests
│   │   └── {feature}-specific-use-case.ts     # Optional: specific use-cases
│   ├── {feature}-decorator.ts                 # Decorator (extends LemappDecorator)
│   ├── {feature}-import.ts                    # Helper imports (optional)
│   ├── {feature}-module.ts                    # Server module functions (optional)
│   └── {feature}-startup.ts                   # Meteor.startup() code (optional)
├── test/                                       # NEW: Renamed from tests/
│   └── e2e/
│       ├── {feature}.e2e.ts                   # E2E tests
│       └── {feature}.page.ts                  # Page Object Model
├── {feature}-code.ts                           # NEW: Error code enum (renamed from -codes)
├── {feature}-conf.ts                          # Constants (SNAKE_UPPERCASE)
├── {feature}-conf-e2e.ts                      # E2E selectors (FEATURE_E2E_IDS)
├── {feature}-log.ts                            # NEW: Human-readable messages (renamed from -logs)
├── {feature}.md                               # Documentation
└── tsconfig.json                              # TypeScript configuration
```

**Note on Backward Compatibility:**

- Legacy files (`{feature}-shared.ts`, `server/{feature}.ts`, `server/{feature}-methods.ts` at root) are still acceptable
- New features SHOULD use the new structure with domain/, use-case/, service/, repository/, controller/
- Both `{feature}-codes.ts`/`{feature}-logs.ts` and `{feature}-code.ts`/`{feature}-log.ts` are acceptable

## Required Files

### 1. `{feature}-code.ts` (or `{feature}-codes.ts`)

**Purpose:** Error code enum

**Naming:** `{FeatureName}Codes` enum

**Pattern:** `[entity/feature]_[action]_[errorType]`

**Note:** Both `{feature}-code.ts` and `{feature}-codes.ts` are acceptable (Notion prefers `-code`, legacy uses `-codes`)

```typescript
// ✅ Correct - Enum
export enum WatchListCodes {
  WATCH_LIST_NOT_FOUND = 'WATCH_LIST_NOT_FOUND',
  WATCH_LIST_INVALID_PARAMS = 'WATCH_LIST_INVALID_PARAMS',
}

// ✅ Correct - Const object (acceptable)
export const LinkedinSignalsCodes = {
  LINKEDIN_SIGNALS_PROVIDER_ERROR: 'LINKEDIN_SIGNALS_PROVIDER_ERROR',
  LINKEDIN_SIGNALS_URL_INVALID_ERROR: 'LINKEDIN_SIGNALS_INVALID_URL_ERROR',
};
```

### 2. `{feature}-log.ts` (or `{feature}-logs.ts`)

**Purpose:** Human-readable error messages for users

**Naming:** `{featureName}Logs` object

**Rule:** One message per error code (1:1 mapping required)

**Usage:** Frontend only - display with `lp.notif.error()`

**Note:** Both `{feature}-log.ts` and `{feature}-logs.ts` are acceptable (Notion prefers `-log`, legacy uses `-logs`)

```typescript
/* eslint-disable @l3mpire/t-missing-translation */
import { lemappLogs } from '/imports/lemapp/lemapp-logs';

export const watchListLogs: Record<string, string> = {
  ...lemappLogs,
  WATCH_LIST_NOT_FOUND: 'Watch list not found',
  WATCH_LIST_INVALID_PARAMS: 'Invalid parameters provided',
};
```

### 3. `{feature}-conf.ts`

**Purpose:** All configuration constants

**Naming:** `FEATURE_NAME_CONST` (SNAKE_UPPERCASE, prefixed with feature name)

**Rule:** NO magic values - any arbitrary value must be defined here

```typescript
export const WATCH_LIST_FEATURE_NAME = 'watchList';
export const WATCH_LIST_MAX_ITEMS = 100;
export const WATCH_LIST_DEFAULT_TIMEOUT = 5000;
export const WATCH_LIST_SLICE_LIMIT = 50;
```

### 4. `{feature}-conf-e2e.ts`

**Purpose:** Selectors for E2E tests

**Naming:** `FEATURE_E2E_IDS` object with `FEATURE_E2E_KEY` properties

**Rule:** Every DOM selector used in E2E MUST be defined here

**Usage:** `data-test={FEATURE_E2E_IDS.FEATURE_E2E_KEY}`

```typescript
export const WATCH_LIST_E2E_IDS = {
  WATCH_LIST_CREATE_BUTTON: 'watch-list-create-button',
  WATCH_LIST_MODAL_NEXT_BUTTON: 'watch-list-modal-next-button',
  WATCH_LIST_FILTER_DROPDOWN: 'watch-list-filter-dropdown',
};
```

### 5. `domain/{feature}-domain.ts` (or legacy: `{feature}-shared.ts`)

**Purpose:** Pure business logic functions (client + server)

**Location:**

- **NEW (Preferred):** `domain/{feature}-domain.ts` - Root-level domain folder for shared logic
- **Legacy (Acceptable):** `{feature}-shared.ts` - Root-level file

**Rules:**

- ❌ NO database access
- ❌ NO HTTP calls
- ❌ NO external APIs
- ❌ NO async operations
- ✅ Pure functions only
- ✅ Business rules only
- ✅ Shared between client AND server

**Important Distinction:**

- `domain/{feature}-domain.ts` (root level) → Shared between client AND server
- `server/domain/{feature}-domain.ts` → Server-only domain logic

```typescript
// ✅ Correct - Pure function in domain/{feature}-domain.ts
export function calculateScore(activity: number, engagement: number): number {
  return Math.round(activity * 0.4 + engagement * 0.6);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ❌ Incorrect - DB call (should be in repository)
export async function getUserScore(userId: string) {
  const user = await Users.findOne(userId); // ❌ DB access
  return calculateScore(user.activity, user.engagement);
}

// ❌ Incorrect - HTTP call (should be in service)
export async function fetchExternalData(url: string) {
  const response = await fetch(url); // ❌ HTTP call
  return response.json();
}
```

### 6. `{feature}.md`

**Purpose:** Complete feature documentation

**Must include:**

- Architecture overview
- Mermaid diagrams (flowcharts required)
- Usage examples
- Test commands

```markdown
# Feature Name

## Overview

Clear and concise description.

## Schema

\`\`\`mermaid
flowchart TD
n1["Component A"] --> n2["Component B"]
n2 --> n3["Result"]
\`\`\`

## Code Coverage

### Unit Tests

\`\`\`bash
FEATURE=feature-name && ./bin/run-tests
\`\`\`
```

### 7. `@types/{feature}.d.ts`

**Purpose:** Shared TypeScript definitions

**Rule:** ALL types/interfaces must be in `.d.ts` files

```typescript
export interface FeatureConfig {
  name: string;
  enabled: boolean;
}

export type FeatureStatus = 'active' | 'inactive' | 'draft';
```

## Required Server Files

### 1. `server/{feature}-decorator.ts`

**MUST extend** `LemappDecorator`

```typescript
import { LemappDecorator } from '/imports/lemapp/server/lemapp-decorator';

class FeatureDecorator extends LemappDecorator {
  // Custom decorators here (optional)
}

const featureDecorator = new FeatureDecorator();
export default featureDecorator;
```

### 2. `server/controller/{feature}-method.ts` (or legacy: `server/{feature}-methods.ts`)

**Rule:** Methods delegate to use-case - NO business logic here

**Location:**

- **NEW (Preferred):** `server/controller/{feature}-method.ts`
- **Legacy (Acceptable):** `server/{feature}-methods.ts`

```typescript
import FeatureUseCase from '/imports/{domain}/{feature}/server/use-case/{feature}-use-case';

Meteor.methods({
  'feature.action': function (params) {
    return FeatureUseCase.action(params);
  },
});
```

### 3. `server/controller/{feature}-route.ts` (or legacy: `server/{feature}-routes.ts`)

**Rule:** API routes delegate to use-case

**Location:**

- **NEW (Preferred):** `server/controller/{feature}-route.ts`
- **Legacy (Acceptable):** `server/{feature}-routes.ts`

```typescript
import FeatureUseCase from '/imports/{domain}/{feature}/server/use-case/{feature}-use-case';

Picker.route('/api/feature/action', async (params, req, res) => {
  const result = await FeatureUseCase.action(params);
  res.end(JSON.stringify(result));
});
```

### 4. `server/use-case/{feature}-use-case.ts` (or legacy: `server/{feature}.ts`)

**Purpose:** Business logic orchestrator (use-case)

**Location:**

- **NEW (Preferred):** `server/use-case/{feature}-use-case.ts`
- **Legacy (Acceptable):** `server/{feature}.ts`

**Pattern:** Static class (stateless) or instance if needed

**Rules:**

- Uses decorators from `{feature}-decorator.ts`
- Orchestrates business logic
- Delegates to services and repositories
- NO direct DB access (use repository)
- NO technical implementation details

```typescript
import featureDecorator from '/imports/{domain}/{feature}/server/{feature}-decorator';
import FeatureService from '/imports/{domain}/{feature}/server/service/{feature}-service';
import FeatureRepository from '/imports/{domain}/{feature}/server/repository/{feature}-repository';

class FeatureUseCase {
  @featureDecorator.isBeta('featureFlag')
  @featureDecorator.log({ duration: { log: true } })
  static async processAction(params: ActionParams): Promise<ActionResult> {
    // Orchestrate business logic
    const entity = await FeatureRepository.findById(params.id);
    const result = await FeatureService.processData(entity);
    await FeatureRepository.update(params.id, result);
    return result;
  }
}

export default FeatureUseCase;
```

### 5. `server/service/{feature}-service.ts` (NEW)

**Purpose:** Reusable business logic services

**Rules:**

- Reusable business logic
- Can call repositories for DB access
- Can be used by multiple use-cases
- NO direct DB access (use repository)
- Can be tested independently

```typescript
import featureDecorator from '/imports/{domain}/{feature}/server/{feature}-decorator';
import FeatureRepository from '/imports/{domain}/{feature}/server/repository/{feature}-repository';
import { calculateScore } from '/imports/{domain}/{feature}/domain/{feature}-domain';

class FeatureService {
  @featureDecorator.log()
  static async processData(entity: Entity): Promise<ProcessedData> {
    // Reusable business logic
    const relatedData = await FeatureRepository.findRelated(entity.id);
    const score = calculateScore(entity.activity, entity.engagement);

    return {
      ...entity,
      relatedData,
      score,
    };
  }

  static async enrichData(data: RawData): Promise<EnrichedData> {
    // Another reusable service method
    const enriched = await FeatureRepository.fetchEnrichmentData(data.id);
    return { ...data, ...enriched };
  }
}

export default FeatureService;
```

### 6. `server/repository/{feature}-repository.ts` (NEW)

**Purpose:** Database access layer

**Rules:**

- DB access ONLY
- ❌ NO business logic
- ✅ CRUD operations only
- ✅ Queries, projections, aggregations
- ✅ MongoDB operations

```typescript
import { FeatureCollection } from '/imports/{domain}/{feature}/collections/{feature}-collection';

class FeatureRepository {
  static async findById(id: string): Promise<Feature | null> {
    return FeatureCollection.findOne({ _id: id });
  }

  static async findByTeamId(teamId: string): Promise<Feature[]> {
    return FeatureCollection.find({ teamId }).fetch();
  }

  static async update(id: string, data: Partial<Feature>): Promise<void> {
    await FeatureCollection.updateAsync({ _id: id }, { $set: data });
  }

  static async create(data: CreateFeatureInput): Promise<string> {
    const id = await FeatureCollection.insertAsync(data);
    return id;
  }

  static async delete(id: string): Promise<void> {
    await FeatureCollection.removeAsync({ _id: id });
  }
}

export default FeatureRepository;
```

### 7. `server/domain/{feature}-domain.ts` (NEW)

**Purpose:** Server-only pure business logic

**Rules:**

- Pure functions
- ❌ NO DB, NO HTTP, NO async
- ✅ Server-only (not imported by client)
- ✅ Server-specific business rules

**Important Distinction:**

- `domain/{feature}-domain.ts` (root level) → Shared between client AND server
- `server/domain/{feature}-domain.ts` → Server-only domain logic

```typescript
// Server-only pure functions
export function calculateServerMetrics(data: ServerData): Metrics {
  // Server-specific calculations
  return {
    cpu: data.cpuUsage / 100,
    memory: data.memoryUsage / data.totalMemory,
  };
}

export function validateServerConfig(config: ServerConfig): boolean {
  // Server-specific validation
  return config.port > 0 && config.port < 65536;
}
```

### 8. `server/cron/{feature}-cron.ts` (or legacy: `server/{feature}-cron.ts`)

**Purpose:** Cron jobs for the feature

**Location:**

- **NEW (Preferred):** `server/cron/{feature}-cron.ts`
- **Legacy (Acceptable):** `server/{feature}-cron.ts`

```typescript
import { SyncedCron } from 'meteor/littledata:synced-cron';
import FeatureUseCase from '/imports/{domain}/{feature}/server/use-case/{feature}-use-case';

SyncedCron.add({
  name: 'feature-daily-job',
  schedule: (parser) => parser.text('every 24 hours'),
  job: async () => {
    await FeatureUseCase.dailyJob();
  },
});
```

### 9. `server/use-case/{feature}-use-case.test.ts` (or legacy: `server/{feature}.test.ts`)

**MUST verify** structure compliance

**Location:**

- **NEW (Preferred):** `server/use-case/{feature}-use-case.test.ts`
- **Legacy (Acceptable):** `server/{feature}.test.ts`

```typescript
const FEATURE = 'feature-name';

describe('Feature Name', () => {
  describe('structure', () => {
    it('should be running in the correct folder structure', () => {
      const currentPath = __filename;
      const expectedPath = `${FEATURE}/server`;
      expect(currentPath).to.include(expectedPath);
    });

    it('should have the correct file name pattern', () => {
      const currentPath = __filename;
      const fileName = currentPath.split('/').pop();
      // Accept both new and legacy naming
      const validNames = [
        `${FEATURE}-use-case.test.ts`, // NEW
        `${FEATURE}.test.ts`, // LEGACY
      ];
      expect(validNames).to.include(fileName);
    });

    it('should have all required files in the feature folder', () => {
      const dir = path.resolve(__dirname, '../..');
      const required = [
        `${FEATURE}-conf.ts`,
        `${FEATURE}-code.ts`, // or ${FEATURE}-codes.ts
        `${FEATURE}-log.ts`, // or ${FEATURE}-logs.ts
        // Accept both new and legacy structure
        `server/controller/${FEATURE}-method.ts`, // NEW
        `server/use-case/${FEATURE}-use-case.ts`, // NEW
        // OR
        // `server/${FEATURE}-methods.ts`,  // LEGACY
        // `server/${FEATURE}.ts`,          // LEGACY
      ];

      required.forEach((p) => {
        try {
          require.resolve(path.resolve(dir, ...p.split('/')));
        } catch (e) {
          // Try legacy path if new path fails
          const legacyPath = p
            .replace('controller/', '')
            .replace('use-case/', '')
            .replace('-use-case.ts', '.ts');
          require.resolve(path.resolve(dir, ...legacyPath.split('/')));
        }
      });
    });

    it('should have a log associated to each error type', () => {
      for (const errorType of Object.values(FeatureCodes)) {
        const log = featureLogs[errorType];
        expect(log).to.be.a('string');
      }
    });
  });
});
```

## Client Files

### 1. `client/component/`

**Structure:**

- `common/` - Context-agnostic, reusable components
- `layout/` - Layouts (modals, panels, wrappers)
  - `modal/` - Modal components
  - `panel/` - Panel components
- `view/` - Feature-specific views

**Rule:** Each component has `.tsx` + optional `.scss` (imported in component)

### 2. `client/hook/`

**Naming:** `use-{feature}-{hook-name}.ts`

**Example:** `use-watch-list-filters.ts`

### 3. `client/store/`

**Naming:** `{feature}-store.ts`

**Rules:**

- State management ONLY
- Local by default (createLocalStore pattern)
- Explicit interface (no generic setters)
- Zustand store

### 4. `client/{feature}-module.ts` (NEW)

**Purpose:** Client-only pure functions

**Rules:**

- Pure functions
- ❌ NO server imports
- ❌ NO DB access
- ✅ Client-specific business logic
- ✅ UI helpers, formatters

```typescript
// ✅ Correct - Client-only pure functions
export function formatDisplayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
```

## E2E Tests

### `test/e2e/{feature}.page.ts` (or legacy: `tests/e2e/{feature}.page.ts`)

**MUST extend** `LemappPage`

**MUST use** `FEATURE_E2E_IDS` from `{feature}-conf-e2e.ts`

**Location:**

- **NEW (Preferred):** `test/e2e/{feature}.page.ts`
- **Legacy (Acceptable):** `tests/e2e/{feature}.page.ts`

```typescript
import { LemappPage } from '@tests/playwright/pages/lemappPage.page';
import { FEATURE_E2E_IDS } from '/imports/feature/feature-conf-e2e';

export class FeaturePage extends LemappPage {
  getElement(dataTestId: string, selector?: string): Locator {
    if (!selector) {
      return this.page.locator(`[data-test="${dataTestId}"]`);
    }
    return this.page.locator(`[data-test="${dataTestId}"] ${selector}`);
  }
}
```

## Validation Checklist

When creating a new feature OR reviewing an existing one, verify:

**FIRST: Read the feature folder to understand current state**

Then check:

- [ ] All required files exist in correct locations (cite missing ones)
- [ ] File naming: `{feature}-{purpose}.ts`
- [ ] `{feature}-conf.ts` contains ALL constants (no magic values)
- [ ] `{feature}-conf-e2e.ts` contains ALL E2E selectors
- [ ] `{feature}-code.ts` (or `-codes.ts`) enum matches `{feature}-log.ts` (or `-logs.ts`) object (1:1)
- [ ] `domain/{feature}-domain.ts` (or `{feature}-shared.ts`) contains only pure functions
- [ ] `server/{feature}-decorator.ts` extends `LemappDecorator`
- [ ] `server/controller/{feature}-method.ts` (or `server/{feature}-methods.ts`) delegates to use-case (no business logic)
- [ ] `server/use-case/{feature}-use-case.ts` (or `server/{feature}.ts`) is a class (static or instance)
- [ ] `server/use-case/{feature}-use-case.test.ts` (or `server/{feature}.test.ts`) verifies structure compliance
- [ ] `server/service/{feature}-service.ts` contains reusable business logic (if applicable)
- [ ] `server/repository/{feature}-repository.ts` contains ONLY DB access (if applicable)
- [ ] `server/domain/{feature}-domain.ts` contains server-only pure functions (if applicable)
- [ ] `client/store/{feature}-store.ts` follows Zustand patterns
- [ ] `test/e2e/{feature}.page.ts` (or `tests/e2e/`) extends `LemappPage`
- [ ] All components import their `.scss` files
- [ ] `{feature}.md` documents the feature with diagrams
- [ ] All imports use absolute paths (`/imports/...`)

**If you haven't read the feature folder, do NOT check these boxes.**

## Common Mistakes to Avoid

**Note: Only flag these if you've READ the feature folder and confirmed the violation**

- ❌ Creating files outside the feature folder (verify with `list_dir`)
- ❌ Using magic values instead of constants (check `-conf.ts` exists)
- ❌ Forgetting E2E selectors in `{feature}-conf-e2e.ts` (verify file exists)
- ❌ Business logic in `server/controller/{feature}-method.ts` (read methods file to verify)
- ❌ Business logic in `server/repository/{feature}-repository.ts` (repository should only do DB access)
- ❌ Direct DB calls in `server/service/{feature}-service.ts` or `server/use-case/{feature}-use-case.ts` (should use repository)
- ❌ DB/HTTP calls in `domain/{feature}-domain.ts` or `{feature}-shared.ts` (read shared file to verify)
- ❌ Confusing `domain/{feature}-domain.ts` (shared client+server) with `server/domain/{feature}-domain.ts` (server-only)
- ❌ Forgetting file extension in imports (`.tsx`, `.ts`)
- ❌ Relative imports instead of absolute paths (grep for `./` or `../`)
- ❌ Forgetting structure validation in tests (check test file)
- ❌ Using `components/` instead of `component/` (singular form preferred in Notion spec)
- ❌ Using `hooks/`, `contexts/`, `stores/` instead of `hook/`, `context/`, `store/` (singular form preferred in Notion spec)

## Architecture Patterns

### Layer Separation

The new architecture follows a clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│ Controller Layer (server/controller/)                   │
│ - Methods: Meteor.methods()                             │
│ - Routes: API endpoints                                 │
│ - Delegates to Use-Case                                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Use-Case Layer (server/use-case/)                       │
│ - Orchestrates business logic                           │
│ - Coordinates services and repositories                 │
│ - Applies decorators                                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Service Layer (server/service/)                         │
│ - Reusable business logic                               │
│ - Calls repositories and domain functions               │
│ - Can be shared across use-cases                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Repository Layer (server/repository/)                   │
│ - Database access ONLY                                  │
│ - CRUD operations                                       │
│ - Queries and aggregations                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Domain Layer                                             │
│ - domain/{feature}-domain.ts (shared client+server)     │
│ - server/domain/{feature}-domain.ts (server-only)       │
│ - Pure functions, NO side effects                       │
└─────────────────────────────────────────────────────────┘
```

### Data Flow Example

```typescript
// 1. Controller receives request
Meteor.methods({
  'feature.processAction': function (params) {
    return FeatureUseCase.processAction(params);
  },
});

// 2. Use-Case orchestrates
class FeatureUseCase {
  @featureDecorator.log()
  static async processAction(params: Params) {
    // Get data from repository
    const entity = await FeatureRepository.findById(params.id);

    // Process via service
    const processed = await FeatureService.enrichData(entity);

    // Apply domain rules
    const score = calculateScore(processed.activity, processed.engagement);

    // Save via repository
    await FeatureRepository.update(params.id, { ...processed, score });

    return processed;
  }
}

// 3. Service provides reusable logic
class FeatureService {
  static async enrichData(entity: Entity) {
    const related = await FeatureRepository.findRelated(entity.id);
    return { ...entity, related };
  }
}

// 4. Repository handles DB
class FeatureRepository {
  static async findById(id: string) {
    return FeatureCollection.findOne({ _id: id });
  }

  static async update(id: string, data: Partial<Entity>) {
    await FeatureCollection.updateAsync({ _id: id }, { $set: data });
  }
}

// 5. Domain provides pure logic
export function calculateScore(activity: number, engagement: number): number {
  return Math.round(activity * 0.4 + engagement * 0.6);
}
```

### Migration from Legacy Structure

When refactoring an existing feature:

**Old structure:**

```
server/
├── feature-methods.ts      → Move to server/controller/feature-method.ts
├── feature-routes.ts       → Move to server/controller/feature-route.ts
├── feature.ts              → Move to server/use-case/feature-use-case.ts
├── feature-cron.ts         → Move to server/cron/feature-cron.ts
└── feature.test.ts         → Move to server/use-case/feature-use-case.test.ts

feature-shared.ts            → Move to domain/feature-domain.ts
```

**New structure:**

```
domain/
└── feature-domain.ts        # Pure shared functions

server/
├── controller/
│   ├── feature-method.ts    # Delegates to use-case
│   └── feature-route.ts     # API endpoints
├── cron/
│   └── feature-cron.ts      # Cron jobs
├── use-case/
│   ├── feature-use-case.ts       # Main orchestrator
│   └── feature-use-case.test.ts  # Tests
├── service/
│   └── feature-service.ts   # Extract reusable logic here
└── repository/
    └── feature-repository.ts # Extract DB calls here
```

**Steps:**

1. Create new folder structure
2. Move existing files to new locations
3. Extract DB calls from use-case to repository
4. Extract reusable logic from use-case to service
5. Update imports across the codebase
6. Update tests to verify new structure

## Verification Checklist Before Suggestion

Before making ANY suggestion based on this rule:

- [ ] I have READ the feature folder structure (via list_dir or read_file)
- [ ] I have IDENTIFIED specific missing/misplaced files
- [ ] I have VERIFIED this is a new feature or confirmed user wants restructuring
- [ ] I have CITED this rule (section of this document)
- [ ] If I'm not sure, I have SAID "I don't know" or asked for confirmation

**If you cannot check all boxes, DO NOT make the suggestion.**

## Reference Examples

- `imports/lemlist/watch-list/` - Complete example with client + E2E
- `modules/company-is-hiring/` - Complete server-only example
- `modules/linkedin-signals/` - Example with custom decorators
