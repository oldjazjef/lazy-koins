---
name: add-feature
description: Add a routed feature or page to apps/web following this repo's conventions - lazy route, OnPush standalone page + page service, httpResource reads, ActionRunner mutations, translated strings, Zod-validated forms. Use when asked to add a page, screen, feature or route to the app.
---

# Add a feature to apps/web

1. **Look first.** `ls apps/web/src/app/features/` (does it belong in an existing feature?),
   `ls libs/ui/` (which spartan components exist — generate missing ones with the
   `add-ui-component` skill), and read the closest sibling page.

2. **Layout** — never nest a routed feature inside another:

   ```
   features/<feature>/
     <feature>.routes.ts          # default-exported Routes, pages via loadComponent
     pages/<page>/<page>.ts|.html|.service.ts|.spec.ts
     components/<c>/<c>.ts + index.ts   # only when >1 page uses it
   ```

   Register it in `app.routes.ts` with `loadChildren`.

3. **Page = component + page service.** The component binds signals and calls plain methods; the
   service does API access and business logic:
   - reads: `httpResource<T>(() => apiUrl('/…'))` — never a raw URL;
   - mutations: `defineAction({ run, messages: { success, error } })` + `ActionRunner.run(...)`,
     messages are i18n keys;
   - a detail page's service holds the id → `@Injectable()` + `providers: [Service]` on the page;
     list/form services are `providedIn: 'root'`.

4. **Rules**: standalone, `ChangeDetectionStrategy.OnPush`, `inject()`, `input()`/`output()`,
   `@if`/`@for`. Route params bind to inputs — give them **no default** (absent params bind as
   `undefined`). Selector prefix `lk-`. No calculation in the app: figures come from the API
   (which runs `libs/engine`).

5. **Numbers**: amounts arrive as decimal strings — format them with shared formatters
   (de-CH, F11.2; create `shared/format/` with the first amount, on top of decimal.js), never
   through `Number()`. Every figure that F7.5 covers is clickable down to its
   bookings.

6. **Forms**: typed reactive forms + `zodValidator(Schema)`; Zod messages are i18n keys rendered
   with `{{ error | translate }}`.

7. **Text**: every string in `public/i18n/de-CH.json`; `pnpm test` fails on a missing key.

8. **Styling**: semantic token classes only; new colours go into `src/styles.css` (both themes).

9. **Test** the page service with `HttpTestingController`, then `pnpm check`. For anything
   visible, run the app and look at it.
