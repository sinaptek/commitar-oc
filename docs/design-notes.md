Inject into OpenCode, or build outside?

My recommendation is neither pure option. Use OpenCode as the engine and keep your logic in an OpenCode-independent layer. A small external CLI generates and checks the OpenCode config.

What the chats show

I read both PDFs. "Mega" is the primary OpenCode agent, with Plan, Build and subagents (code-reviewer, debugger, backend-architect, test-writer). It runs a phased pipeline on a real project, Metrix: phases, RED/GREEN tests, AUDIT, commit. That pipeline is the commitar behavior you want to reproduce.

Almost every problem in the chats comes from the plumbing, not the workflow:
- Rate limits and model IDs. Gemini quota, OpenRouter credits, a :free suffix that doesn't exist, Groq and OpenAI with no key. The subagents kept failing because each had its own hand-edited model: line.
- Config schema errors. permission instead of permissions, an invalid sse type, mcp versus remote.
- Windows and MCP issues. npx stdio, -32000 Connection closed, hardcoded C:\Users\PC\... paths.
- Per-project versus global config drift. Agents copied between .opencode/agents and ~/.config/opencode/agents with PowerShell one-liners.

Why not a fully external build

Building outside means rewriting the agent loop, tool calling, provider handling, the TUI, diffs and permissions. That is a large effort, and it defeats the goal of cheap and fast. OpenCode already does all of it, and it works with free providers.

Why not pure injection

Everything would depend on OpenCode's config schema, which already tripped you several times in the chats. It would also be hand-edited and fragile. Your real asset, the commitar workflow and the handoff to paid commitar, would be locked inside OpenCode-specific files.

Proposed structure

1. Protocol layer (tool-agnostic).
   - This holds the phase pipeline (spec, RED, GREEN, AUDIT, commit), the agent roles, and the vault conventions.
   - It also holds a HANDOFF or state file that paid commitar can ingest.
   - It is plain markdown and JSON, so it survives any change of engine.
   - It is the part that makes "start free, continue in commitar" work.
2. OpenCode adapter (generated).
   - opencode.json, agents/*.md, commands and custom tools are produced from templates by commitar-oc init, not edited by hand.
   - Model IDs live in one place, as aliases such as strong and fast, with one fix point.
   - The generator uses the schema that actually works, and validates it by starting OpenCode once.
3. Thin external CLI.
   - It handles init, doctor (provider, MCP and paths check) and handoff export. It does not run the agent loop.
4. Model routing in the proxy.
   - You already have a proxy at 127.0.0.1:8765 (Headroom). Put the fallback chain there, so a rate limit on Gemini rolls to the next provider without touching agent files. This is the fix for most of the pain in 1.pdf.

The folders you mentioned

┌───────────────────────┬──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│         Item          │                           Role                           │                                                      Advice                                                      │
├───────────────────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ dev/agency-agents     │ 59 engineering personas, plus other divisions            │ Source catalog. Select and trim a few personas into the adapter. Don't load them all, because they are           │
│                       │                                                          │ token-heavy.                                                                                                     │
├───────────────────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ dev/prime-agent       │ A separate full agent harness                            │ Per the chat, it only served as inspiration. The root skills/*.py is not loaded by OpenCode. Convert those       │
│                       │                                                          │ functions to OpenCode custom tools, or drop them. Don't make it a runtime dependency.                            │
├───────────────────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ obsidian-second-brain │ Skill and command set with an OpenCode adapter           │ Use its installer instead of hand-wiring. The vault is just markdown, so the Obsidian desktop app is optional on │
│                       │ (adapters/opencode/adapter.sh)                           │  a server. Gemini's advice to install the app was unnecessary here.                                              │
└───────────────────────┴──────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Treat all three as pinned, vendored sources that the installer copies from, not as paths the system depends on at runtime. Today the paths are hardcoded, and dev and obsidian-second-brain are owned by mariano while the rest is owned by commitar. Expect permission friction.

Memory

I'd drop claude-mem from the first version. In the chats it took about half the effort: it lost its connection, the worker died when the shell closed, and the config path is Windows-only. The vault plus a HANDOFF file covers the same need with no daemon. Add it later if you miss it.

Caveats

- OpenCode isn't installed on this machine, so I haven't checked its current plugin, custom-tool and agent schema. Verify that before building the adapter.
- Free models make the AUDIT step weaker. Anchor it on deterministic gates (tests, lint, typecheck) rather than model judgment.

Next step

I can sketch the commitar-oc init design: the repo layout, the single model-alias file, the doctor checks, and the HANDOFF format. Say if you want me to start there.