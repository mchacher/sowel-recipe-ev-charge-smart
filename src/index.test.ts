import { describe, expect, it } from "vitest";
import { createRecipe, RECIPE_ID } from "./index.js";

describe("createRecipe", () => {
  it("declares the ev-charge-smart identity", () => {
    expect(createRecipe().id).toBe(RECIPE_ID);
  });
});
