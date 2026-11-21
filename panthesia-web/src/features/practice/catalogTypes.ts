import type {
  ExercisePreset,
  ExerciseCatalog as WireExerciseCatalog,
} from "../../engine/commands.generated";
export type { PassageCatalog } from "../../engine/commands.generated";
// ExerciseSpec accepts omitted input defaults; saved presets serialize every field.
export type SavedExercisePreset = Omit<ExercisePreset, "spec"> & {
  spec: Required<ExercisePreset["spec"]>;
};
export type ExerciseCatalog = Omit<WireExerciseCatalog, "presets"> & {
  presets: SavedExercisePreset[];
};
