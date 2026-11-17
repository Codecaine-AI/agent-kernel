// Writes baml_client at the pack root, where the agent-kernel provider imports it from PACK_DIR.
// Regenerate with `bun run generate` in the pack root, and commit the result.
generator target {
  output_type "typescript"
  output_dir "../"
  version "0.226.2"
  default_client_mode async
  module_format "esm"
}
