import { Elysia, t } from 'elysia';
import { ServiceContainer } from '../services/service-container';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';
import { validateAndSanitizeText, MAX_LENGTHS } from '../utils/validation';

/**
 * Safely parses JSON values, handling both JSON-encoded strings and plain strings
 * @param value The string value to parse
 * @returns Parsed JSON object or original string if not valid JSON
 */
function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Creates user preferences routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for user preferences
 */
export function createPreferencesRoutes(services: ServiceContainer) {
  const { db, requireRole } = services;
  return new Elysia({ prefix: '/api/preferences' })

    // === Preference Retrieval ===

    /**
     * Get all user preferences
     * @returns Object containing all user preferences
     */
    .get('/', requireRole('user')(async ({ user }: any) => {
      try {
        const preferences = db.prepare(`
          SELECT preference_key, preference_value
          FROM user_preferences
          WHERE user_id = ?
        `).all(user.id);

        const result: Record<string, any> = {};
        for (const pref of preferences as any[]) {
          result[pref.preference_key] = safeJsonParse(pref.preference_value);
        }

        return createSuccessResponse(result);
      } catch (error) {
        console.error('Error fetching user preferences:', error);
        return createErrorResponse('Failed to fetch preferences');
      }
    }))

    /**
     * Get a specific user preference by key
     * @param params.key - Preference key
     * @returns Preference value
     */
    .get('/:key', requireRole('user')(async ({ params, user, set }: any) => {
      try {
        // Validate preference key
        const keyValidation = validateAndSanitizeText(params.key, MAX_LENGTHS.NAME, 'Preference key');
        if (!keyValidation.isValid) {
          set.status = 400;
          return createErrorResponse(keyValidation.error || 'Invalid preference key');
        }

        const preference = db.prepare(`
          SELECT preference_value
          FROM user_preferences
          WHERE user_id = ? AND preference_key = ?
        `).get(user.id, keyValidation.sanitizedValue) as any;

        if (!preference) {
          return createErrorResponse('Preference not found');
        }

        return createSuccessResponse({ value: safeJsonParse(preference.preference_value) });
      } catch (error) {
        console.error('Error fetching user preference:', error);
        return createErrorResponse('Failed to fetch preference');
      }
    }), {
      params: t.Object({
        key: t.String({ minLength: 1 })
      })
    })

    // === Preference Modification ===

    /**
     * Update or create a user preference
     * @param params.key - Preference key
     * @param body.value - Preference value
     * @returns Success confirmation
     */
    .put('/:key', requireRole('user')(async ({ params, body, user, set }: any) => {
      try {
        // Validate preference key
        const keyValidation = validateAndSanitizeText(params.key, MAX_LENGTHS.NAME, 'Preference key');
        if (!keyValidation.isValid) {
          set.status = 400;
          return createErrorResponse(keyValidation.error || 'Invalid preference key');
        }

        const value = JSON.stringify(body.value);

        db.prepare(`
          INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(user.id, keyValidation.sanitizedValue, value);

        return createSuccessResponse({ success: true });
      } catch (error) {
        console.error('Error saving user preference:', error);
        set.status = 500;
        return createErrorResponse('Failed to save preference');
      }
    }), {
      params: t.Object({
        key: t.String({ minLength: 1 })
      }),
      body: t.Object({
        value: t.Unknown()
      })
    })

    // === Bulk Operations ===

    /**
     * Update multiple user preferences at once
     * @param body.preferences - Object containing preference key-value pairs
     * @returns Success confirmation
     */
    .post('/bulk', requireRole('user')(async ({ body, user, set }: any) => {
      try {
        const preferences = body.preferences as Record<string, any>;

        db.transaction(() => {
          for (const [key, value] of Object.entries(preferences)) {
            const stringValue = JSON.stringify(value);
            db.prepare(`
              INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `).run(user.id, key, stringValue);
          }
        })();

        return createSuccessResponse({ success: true });
      } catch (error) {
        console.error('Error saving user preferences:', error);
        set.status = 500;
        return createErrorResponse('Failed to save preferences');
      }
    }), {
      body: t.Object({
        preferences: t.Record(t.String(), t.Unknown())
      })
    })

    /**
     * Delete a user preference
     * @param params.key - Preference key to delete
     * @returns Success confirmation
     */
    .delete('/:key', requireRole('user')(async ({ params, user, set }: any) => {
      try {
        // Validate preference key
        const keyValidation = validateAndSanitizeText(params.key, MAX_LENGTHS.NAME, 'Preference key');
        if (!keyValidation.isValid) {
          set.status = 400;
          return createErrorResponse(keyValidation.error || 'Invalid preference key');
        }

        db.prepare(`
          DELETE FROM user_preferences
          WHERE user_id = ? AND preference_key = ?
        `).run(user.id, keyValidation.sanitizedValue);

        return createSuccessResponse({ success: true });
      } catch (error) {
        console.error('Error deleting user preference:', error);
        return createErrorResponse('Failed to delete preference');
      }
    }), {
      params: t.Object({
        key: t.String({ minLength: 1 })
      })
    });
}
