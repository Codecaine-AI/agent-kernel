---
covers: "The purpose of the Pi Agent Kernel as a portable agent runtime plus observability foundation."
concepts: [purpose, runtime, observability, viewer, reusable-platform, vertical-harness, token-cost, model-routing]
---

# Purpose

The kernel exists so agent systems can share a strong runtime and viewing foundation without sharing the same product workflow — and so that verticals can scale agent work without scaling blind.

---

## The Stakes

The kernel is designed for agent systems that are extraordinarily token-hungry. A workload that spins up, say, 64 parallel workers can spend thousands of dollars in minutes. In that regime, cost is the dominant engineering risk: if you cannot see where tokens are going and measure the effectiveness behind each spend, you have no way to make the system sustainable.

This is why observability and control are not secondary features. They are the reason the kernel exists. The product of an agent system is not just the work it does — it is *viewable* agent execution that you can attribute, budget, and improve.

---

## Problem

Agent applications tend to rebuild the same hard parts:

- spawning agents from declarative definitions
- assembling context consistently
- enforcing tool and filesystem boundaries
- running foreground and background subagents
- capturing Pi SDK session JSONL
- storing runs and trace events durably
- reading traces back through stable APIs
- rendering trace trees, transcripts, and run details in a viewer

Spectre proved those pieces are useful, but Spectre also mixed them with coding-workflow semantics: sessions, phases, checkpoints, asks, docs, build status, and project worktrees. The kernel separates the reusable platform from the application-specific layer.

## Product Shape

The kernel is not just a spawn helper. Its product is viewable agent execution.

A host app should be able to boot the kernel, register agents and loaders, run work, and immediately inspect:

- which container the work belonged to
- which agent and run executed
- which tool call spawned a subagent
- which prompt and context were resolved
- which Pi messages and tool calls appeared
- which lifecycle and diagnostic events occurred

That visibility is the base stock for designing better agent systems.

## First Reference App

Spectre is the reference application. It uses the kernel to run a coding workflow, but Spectre's workflow concepts are not kernel concepts. Spectre should show how to extend the kernel, not define what the kernel is.
