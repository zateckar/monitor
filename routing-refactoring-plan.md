# Routing Refactoring Plan

## Phase 1: Critical Path Fixes (High Priority)

### 1.1 Fix Endpoints Route Redundancy
**File**: `backend/src/routes/endpoints.ts`
**Issue**: Routes have redundant `/endpoints` path due to prefix
**Impact**: Breaking REST conventions, confusing API structure

**Changes Required**:
```typescript
// Change from:
.get('/endpoints', requireRole('user')(async () => {
// To:
.get('/', requireRole('user')(async () => {

// This fixes: /api/endpoints/endpoints → /api/endpoints
```

**Frontend Impact**: Update API calls from `/api/endpoints/endpoints` to `/api/endpoints`

### 1.2 Fix Users Route Prefix
**File**: `backend/src/routes/users.ts`
**Issue**: Using `/api/admin` prefix instead of `/api/users`
**Impact**: Confusing route structure, users !== admin

**Changes Required**:
```typescript
// Change from:
return new Elysia({ prefix: '/api/admin' })
// To:
return new Elysia({ prefix: '/api/users' })
```

**Frontend Impact**: Update API calls from `/api/admin/users` to `/api/users`

### 1.3 Fix System Route Redundancy
**File**: `backend/src/routes/system.ts`
**Issue**: Routes have redundant `/system` in path
**Impact**: Creates `/api/system/system/*` paths

**Changes Required**:
```typescript
// Change from:
.get('/system/distributed-config', requireRole('admin')(async () => {
.put('/system/distributed-config', requireRole('admin')(async ({ body }: any) => {
.post('/system/generate-shared-secret', requireRole('admin')(async () => {
.get('/system/instances', requireRole('admin')(async () => {
.delete('/system/instances/:instanceId', requireRole('admin')(async ({ params }: any) => {
.post('/system/instances/:instanceId/promote', requireRole('admin')(async ({ params }: any) => {
.get('/system/info', async () => {
.get('/system/auth-status', async () => {
.get('/system/connection-status', async () => {
.post('/system/test-connection', requireRole('admin')(async ({ body }: any) => {
.post('/system/reauthenticate', requireRole('admin')(async ({ body }: any) => {

// To:
.get('/distributed-config', requireRole('admin')(async () => {
.put('/distributed-config', requireRole('admin')(async ({ body }: any) => {
.post('/generate-shared-secret', requireRole('admin')(async () => {
.get('/instances', requireRole('admin')(async () => {
.delete('/instances/:instanceId', requireRole('admin')(async ({ params }: any) => {
.post('/instances/:instanceId/promote', requireRole('admin')(async ({ params }: any) => {
.get('/info', async () => {
.get('/auth-status', async () => {
.get('/connection-status', async () => {
.post('/test-connection', requireRole('admin')(async ({ body }: any) => {
.post('/reauthenticate', requireRole('admin')(async ({ body }: any) => {
```

**Frontend Impact**: Update all system API calls to remove `/system` prefix

## Phase 2: Response Pattern Standardization (Medium Priority)

### 2.1 Standardize Error Responses
**Affected Files**: All route files
**Issue**: Inconsistent error response patterns

**Standard Pattern**:
```typescript
// Preferred approach - use set.status with direct return
if (!isValid) {
  set.status = 400;
  return { error: 'Validation failed', details: errors };
}

// Avoid manual Response objects unless specific headers needed
// OLD (avoid):
return new Response(JSON.stringify({ error: 'message' }), {
  status: 400,
  headers: { 'Content-Type': 'application/json' }
});

// NEW (preferred):
set.status = 400;
return { error: 'message' };
```

### 2.2 Remove Manual JSON Handling
**Files**: `users.ts`, `system.ts`, `endpoints.ts`
**Issue**: Manual JSON parsing and Response creation

**Changes**:
- Remove manual `await request.json()` calls - use Elysia's body validation
- Remove manual Response object creation for normal responses
- Keep Response objects only for specific headers/cookies

## Phase 3: Authentication Consistency (Medium Priority)

### 3.1 Remove Manual Auth Logic
**Files**: Multiple route files with manual auth checks
**Issue**: Inconsistent auth pattern, not using middleware

**Standard Pattern**:
```typescript
// Remove manual auth checks like:
const user = await authService.authenticateUser(context.request);
if (!user) {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Use middleware instead:
.get('/protected-route', requireRole('user')(async ({ user }) => {
  // User is available via middleware
}))
```

## Phase 4: Route Organization (Low Priority)

### 4.1 Remove Test Routes
**File**: `system.ts`
**Issue**: Test endpoint in production code

**Remove**:
```typescript
.get('/test/instances', async () => {
  console.log('=== /api/test/instances endpoint called (no auth) ===');
  return { message: 'Test endpoint working', timestamp: new Date().toISOString() };
})
```

### 4.2 Group Related Routes
**All Files**: Better organization within route files
- Group CRUD operations together
- Separate admin-only routes from user routes
- Add clear comments for route sections

## Implementation Steps

### Step 1: Fix Critical Path Issues
1. **Fix endpoints.ts redundancy** (Priority 1)
2. **Fix users.ts prefix** (Priority 1) 
3. **Fix system.ts redundancy** (Priority 1)

### Step 2: Update Frontend API Calls
1. Update `frontend/src/utils/apiClient.ts`
2. Search and replace API endpoint calls
3. Test all affected functionality

### Step 3: Standardize Responses
1. Implement consistent error handling pattern
2. Remove manual Response object creation where not needed
3. Update authentication middleware usage

### Step 4: Testing & Documentation
1. Test all API endpoints
2. Update API documentation
3. Add route validation tests

## Breaking Changes Summary

### Frontend API Changes Required:
```typescript
// Endpoints:
'/api/endpoints/endpoints' → '/api/endpoints'

// Users:  
'/api/admin/users' → '/api/users'

// System:
'/api/system/system/distributed-config' → '/api/system/distributed-config'
'/api/system/system/instances' → '/api/system/instances'
'/api/system/system/info' → '/api/system/info'
// ... etc for all /system/system/* routes
```

## Benefits After Refactoring

1. **Consistent REST API structure** - Clean, predictable endpoints
2. **Simplified routing logic** - Easier to understand and maintain
3. **Better error handling** - Consistent error responses across all endpoints
4. **Improved authentication** - Standardized middleware usage
5. **Cleaner codebase** - Removed redundancy and manual workarounds

## Risk Mitigation

1. **Incremental deployment** - Deploy one route file at a time
2. **Backward compatibility** - Temporarily support old routes during transition
3. **Comprehensive testing** - Test all API endpoints before and after changes
4. **Documentation updates** - Update all API documentation simultaneously
