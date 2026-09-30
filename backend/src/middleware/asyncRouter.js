/**
 * Express 4 does not forward rejected async route handlers to error
 * middleware. Wrap registered router handlers once at startup.
 * This includes the existing routes while the oversized routers are
 * being refactored into independently tested services.
 */
export function captureAsyncRouter(router) {
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack || []) {
        const original = routeLayer.handle;
        if (original.length === 4 || original.__asyncWrapped) continue;
        const wrapped = function (req, res, next) {
          try {
            const result = original(req, res, next);
            if (result && typeof result.catch === "function") {
              result.catch(next);
            }
          } catch (error) {
            next(error);
          }
        };
        wrapped.__asyncWrapped = true;
        routeLayer.handle = wrapped;
      }
    }
  }
  return router;
}
