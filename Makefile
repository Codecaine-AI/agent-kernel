PORT ?= 8791
FRONTEND_PORT ?= 5175
AGENT_KERNEL_DATABASE_URL ?= postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel

.PHONY: research-ui
research-ui:
	@echo "Starting Simple Research Kernel UI"
	@echo "  Viewer: http://127.0.0.1:$(FRONTEND_PORT)"
	@echo "  API:    http://127.0.0.1:$(PORT)"
	@echo "  DB:     $(AGENT_KERNEL_DATABASE_URL)"
	AGENT_KERNEL_DATABASE_URL="$(AGENT_KERNEL_DATABASE_URL)" PORT=$(PORT) FRONTEND_PORT=$(FRONTEND_PORT) bun run dev:simple-research
