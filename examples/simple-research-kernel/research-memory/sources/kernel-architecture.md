# Kernel Architecture Notes

- The kernel owns generic runtime concerns: `createKernel`, run context, agent registry, context assembly, subagent management, protocol events, and trace reading.
- The host application owns product semantics: agent catalog, domain tools, app-specific loaders, session mapping, and generated artifacts.
- Filesystem agent definitions use `agent.md` plus optional sidecars such as `context.ts`.
- Context loaders are declared by each agent and resolved through a catalog that combines portable kernel loaders with app-specific loaders.
