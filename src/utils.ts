// Compatibility shim after the Phase 1 refactor split utils.ts by responsibility.
// New code should import from the specific module; existing imports keep working.
export * from "./dates";
export * from "./clinicalTextFormat";
export * from "./labParsing";
export * from "./patientModel";
export { labCatalog } from "./data/labDictionary";
