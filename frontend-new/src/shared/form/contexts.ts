/**
 * The field and form contexts every bound component reads.
 *
 * Separate from `index.ts` because `createFormHook` needs these to exist before
 * it can bind components to them, and the components themselves need to import
 * `useFieldContext` — a cycle if it all lived in one module.
 */

import { createFormHookContexts } from "@tanstack/react-form"

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()
