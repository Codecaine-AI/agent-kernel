PORT ?= 8788
FRONTEND_PORT ?= 5174
.PHONY: research-ui
research-ui:
	@echo "Starting Simple Research Kernel UI"
	@echo "  Viewer: http://127.0.0.1:$(FRONTEND_PORT)"
	@echo "  API:    http://127.0.0.1:$(PORT)"
	@echo "  DB:     examples/simple-research-kernel/.agent-kernel/trace.db (local SQLite)"
	PORT=$(PORT) FRONTEND_PORT=$(FRONTEND_PORT) bun run dev:simple-research

.PHONY: doctor
doctor:
	bun run packages/kernel/src/doctor-cli.ts examples/simple-research-kernel/.agent-kernel/trace.db
