import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';

export function createPreferencesRoutes(
  db: Database,
  requireRole: (role: 'admin' | 'user') => (handler: any) => any
) {
  return new Elysia({ prefix: '/api/preferences' })
    .get('/', requireRole('user')(async ({ user }: any) => {
      try {
        const preferences = db.prepare(`
          SELECT preference_key, preference_value
          FROM user_preferences
          WHERE user_id = ?
        `).all(user.id);

        const result: Record<string, any> = {};
        for (const pref of preferences as any[]) {
          try {
            result[pref.preference_key] = JSON.parse(pref.preference_value);
          } catch {
            result[pref.preference_key] = pref.preference_value;
          }
        }

        return result;
      } catch (error) {
        console.error('Error fetching user preferences:', error);
        return { error: 'Failed to fetch preferences' };
      }
    }))
    .get('/:key', requireRole('user')(async ({ params, user }: any) => {
      try {
        const preference = db.prepare(`
          SELECT preference_value
          FROM user_preferences
          WHERE user_id = ? AND preference_key = ?
        `).get(user.id, params.key) as any;

        if (!preference) {
          return { error: 'Preference not found' };
        }

        try {
          return { value: JSON.parse(preference.preference_value) };
        } catch {
          return { value: preference.preference_value };
        }
      } catch (error) {
        console.error('Error fetching user preference:', error);
        return { error: 'Failed to fetch preference' };
      }
    }))
    .put('/:key', requireRole('user')(async ({ params, request, user, set }: any) => {
      try {
        // Parse request body manually
        let body: any;
        try {
          body = await request.json();
        } catch (error) {
          set.status = 400;
          return { error: 'Invalid JSON in request body' };
        }

        // Validate that body exists and has value property
        if (!body || typeof body !== 'object' || !('value' in body)) {
          set.status = 400;
          return { error: 'Request body must contain a "value" property' };
        }

        const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);

        db.prepare(`
          INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(user.id, params.key, value);

        return { success: true };
      } catch (error) {
        console.error('Error saving user preference:', error);
        set.status = 500;
        return { error: 'Failed to save preference' };
      }
    }))
    .post('/bulk', requireRole('user')(async ({ request, user, set }: any) => {
      try {
        // Parse request body manually
        let body: any;
        try {
          body = await request.json();
        } catch (error) {
          set.status = 400;
          return { error: 'Invalid JSON in request body' };
        }

        // Validate that body exists and has preferences property
        if (!body || typeof body !== 'object' || !body.preferences || typeof body.preferences !== 'object') {
          set.status = 400;
          return { error: 'Request body must contain a "preferences" object' };
        }

        const preferences = body.preferences as Record<string, any>;
        
        db.transaction(() => {
          for (const [key, value] of Object.entries(preferences)) {
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            db.prepare(`
              INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `).run(user.id, key, stringValue);
          }
        })();

        return { success: true };
      } catch (error) {
        console.error('Error saving user preferences:', error);
        set.status = 500;
        return { error: 'Failed to save preferences' };
      }
    }))
    .delete('/:key', requireRole('user')(async ({ params, user }: any) => {
      try {
        db.prepare(`
          DELETE FROM user_preferences
          WHERE user_id = ? AND preference_key = ?
        `).run(user.id, params.key);

        return { success: true };
      } catch (error) {
        console.error('Error deleting user preference:', error);
        return { error: 'Failed to delete preference' };
      }
    }));
}
