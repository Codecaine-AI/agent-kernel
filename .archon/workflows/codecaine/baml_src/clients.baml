// The agent-kernel provider sets the client of every call from the node's tier
// (assistants.agent-kernel.aliases), so this client only lets the functions compile.
// It is never sent, and it holds no key.
client<llm> PackDefault {
  provider "openai-responses"
  options {
    model "set-by-the-kernel"
    api_key "set-by-the-kernel"
  }
}
