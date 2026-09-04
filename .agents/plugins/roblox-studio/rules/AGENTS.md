# Roblox Studio Agent Rules for Antigravity

When interacting with Roblox Studio via the `roblox` MCP server:
- Always check instance hierarchy or script content with `search_game_tree`, `inspect_instance`, or `script_read` before creating or editing scripts.
- Use `execute_luau` for running Luau scripts in Studio. Remember to use `return` to capture output (prints are not captured).
- Use `multi_edit` to create or update scripts. Always make sure `old_string` matches exact content (use `script_read` first).
- Follow modern Luau standards: `--!strict` typing, `task.wait/spawn/delay` (never legacy `wait/spawn`), and server-authoritative security for RemoteEvents.
- Check runtime logs with `get_console_output` to verify script execution and diagnose errors.
