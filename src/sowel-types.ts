/**
 * The slice of Sowel's recipe API this recipe uses, mirrored by hand from
 * `src/shared/types.ts` and `src/recipes/engine/recipe.ts` in mchacher/sowel.
 * Recipes never import the core. Extend when a new member is needed; never
 * widen a type to make something compile.
 */

export interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "text" | "select";
  required: boolean;
  list?: boolean;
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: string | string[];
    min?: number;
    max?: number;
    crossZone?: boolean;
    includeDescendants?: boolean;
  };
  group?: string;
}

export interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, { name: string; description: string }>;
  groups?: Record<string, string>;
}

export interface RecipeTile {
  icon: string;
  summaryKey?: string;
}

export interface RecipeInstanceHandle {
  stop(): void;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  tile?: RecipeTile;
  i18n?: Record<string, RecipeLangPack>;
  validate(params: Record<string, unknown>, ctx: RecipeContext): void;
  createInstance(params: Record<string, unknown>, ctx: RecipeContext): RecipeInstanceHandle;
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
}

export interface DataBindingValue {
  alias: string;
  value: unknown;
}

export interface OrderBindingLike {
  alias: string;
}

export interface EquipmentManager {
  getById(id: string): Equipment | null;
  getDataBindingsWithValues(id: string): DataBindingValue[];
  /** Order bindings of an equipment (aliases only are used). */
  getOrderBindingsWithDetails?(id: string): OrderBindingLike[];
}

export interface DispatchResult {
  success: boolean;
  error?: string;
}

export type RevokeReason =
  "surplus-deficit" | "priority-preempted" | "manual-override" | "meter-stale" | "disabled";

export interface CapacityClaimRequest {
  equipmentId: string;
  watts?: number;
  toleratedImportW?: number;
  slack?: "none" | "some" | "high";
  note?: string;
  onGranted: () => void;
  onRevoked: (reason: RevokeReason | string) => void;
}

export interface CapacityClaimHandle {
  id: string;
  status(): "pending" | "granted" | "denied" | "released";
  deniedReason?: string;
  release(): void;
  reportNeed?(need: boolean): void;
}

export interface RecipeTariff {
  configured: boolean;
  offPeakToday: { start: string; end: string }[];
  isOffPeakNow: boolean | null;
}

export interface DataChangedEvent {
  type: "equipment.data.changed";
  equipmentId: string;
  alias: string;
  value: unknown;
  previous: unknown;
}

export interface RecipeLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export interface RecipeContext {
  eventBus: { onType(type: string, handler: (event: unknown) => void): () => void };
  equipmentManager: EquipmentManager;
  logger: RecipeLogger;
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
  log(message: string, level?: "info" | "warn" | "error"): void;
  helpers: {
    getTariff?(): RecipeTariff;
    energy?: {
      claimCapacity(req: CapacityClaimRequest): CapacityClaimHandle;
    };
  };
  dispatchOrder(equipmentId: string, alias: string, value: unknown): Promise<DispatchResult>;
}
