import type { RecipeLangPack, RecipeSlotDef } from "./sowel-types.js";

export const SLOTS: RecipeSlotDef[] = [
  // Every recipe declares its zone: the form fills it with the current zone,
  // and a zone's Behaviours list shows the instances whose `zone` is that zone.
  {
    id: "zone",
    name: "Zone",
    description: "The zone this recipe belongs to",
    type: "zone",
    required: true,
  },
  {
    id: "charger",
    name: "Charger",
    description: "The EV charger to drive",
    type: "equipment",
    required: true,
    constraints: { equipmentType: "ev_charger", crossZone: true },
  },
  {
    id: "vehicles",
    name: "Vehicles",
    description:
      "Cars that charge on it (their battery level sets the targets; they are woken when needed)",
    type: "equipment",
    required: false,
    list: true,
    constraints: { equipmentType: "electric_vehicle", crossZone: true },
  },
  {
    id: "target_soc",
    name: "Target (%)",
    description: "Surplus charging stops here, or at the car's own limit if lower",
    type: "number",
    required: true,
    defaultValue: 80,
    constraints: { min: 20, max: 100 },
  },
  {
    id: "min_soc",
    name: "Guaranteed minimum (%)",
    description: "Reached by the departure time, from off-peak hours first. 0 disables it",
    type: "number",
    required: true,
    defaultValue: 30,
    constraints: { min: 0, max: 100 },
  },
  {
    id: "departure",
    name: "Departure",
    description: "When the minimum must be reached, every day",
    type: "time",
    required: true,
    defaultValue: "07:30",
  },
  {
    id: "charge_current",
    name: "Charge current (A)",
    description: "The current the charger is set to when the recipe starts it",
    type: "number",
    required: true,
    defaultValue: 10,
    constraints: { min: 6, max: 32 },
  },
];

export const I18N: Record<string, RecipeLangPack> = {
  fr: {
    name: "Recharge VE intelligente",
    description:
      "Recharge sur le surplus solaire jusqu'à une cible, garantit un minimum avant le départ, réveille la voiture endormie.",
    slots: {
      zone: { name: "Zone", description: "La zone à laquelle appartient la recette" },
      charger: { name: "Borne", description: "La borne de recharge à piloter" },
      vehicles: {
        name: "Véhicules",
        description:
          "Les voitures qui s'y rechargent (leur batterie fixe les objectifs ; réveillées si besoin)",
      },
      target_soc: {
        name: "Cible (%)",
        description:
          "La charge sur surplus s'arrête ici, ou à la limite de la voiture si elle est plus basse",
      },
      min_soc: {
        name: "Minimum garanti (%)",
        description: "Atteint avant l'heure de départ, en heures creuses d'abord. 0 le désactive",
      },
      departure: {
        name: "Départ",
        description: "Heure à laquelle le minimum doit être atteint, chaque jour",
      },
      charge_current: {
        name: "Courant de charge (A)",
        description: "Le courant réglé sur la borne quand la recette démarre la charge",
      },
    },
  },
};
