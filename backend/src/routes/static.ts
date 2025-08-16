import { Elysia } from 'elysia';
import { StaticFileService } from '../services/static-files';

export function createStaticRoutes(staticFileService: StaticFileService) {
  return new Elysia()
    .get('/*', async ({ request, set }) => {
      return await staticFileService.serveFile(request, set);
    });
}
