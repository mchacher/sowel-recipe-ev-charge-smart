/**
 * Sowel recipe: ev-charge-smart
 *
 * Skeleton: it declares the recipe and its slots. The decision logic, the
 * charger actions and the lifecycle arrive with spec 001.
 */

export const RECIPE_ID = "ev-charge-smart";

interface RecipeInstanceHandle {
  stop(): void;
}

export interface RecipeDefinitionLike {
  id: string;
  name: string;
  description: string;
  slots: unknown[];
  validate(params: Record<string, unknown>, ctx: unknown): void;
  createInstance(params: Record<string, unknown>, ctx: unknown): RecipeInstanceHandle;
}

export function createRecipe(): RecipeDefinitionLike {
  return {
    id: RECIPE_ID,
    name: "Smart EV charging",
    description: "Solar-surplus EV charging with a guaranteed minimum by departure.",
    slots: [],
    validate() {
      throw new Error("ev-charge-smart is not implemented yet (spec 001)");
    },
    createInstance() {
      return { stop() {} };
    },
  };
}
